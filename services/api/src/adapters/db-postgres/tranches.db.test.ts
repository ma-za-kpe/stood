import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executePayment } from '../../application/execute-payment.js';
import { reconcile } from '../../application/reconcile.js';
import { retryCapture } from '../../application/retry-capture.js';
import { RULE_SET_VERSION } from '../../domain/decision.js';
import { createTrancheRecord, restoreTrancheRecord, type TrancheCommand } from '../../domain/tranche-record.js';
import { PostgresPaymentOperations } from './payment-operations.js';
import * as schema from './schema.js';
import { PostgresTranches } from './tranches.js';

const name = `test_tranches_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const options = {
  connectionString: `postgres://stood:stood_local_only@db:5432/${name}`,
  options: '-c statement_timeout=5000',
};
const pool = new pg.Pool(options);
const db = drizzle(pool, { schema });
const store = new PostgresTranches(db);
const at = 1790985600000;
const expiry = at + 29 * 86400000;
const cmd = (method: TrancheCommand['method'], args: unknown[] = []) => ({ method, args }) as unknown as TrancheCommand;
const definition = (id: string) => ({
  id,
  amount: { minor: 1000, currency: 'GBP' },
  profileId: 'construction.stage@1',
  maxResubmits: 1,
});
const release = {
  outcome: 'RELEASE',
  effect: 'CAPTURE',
  profileId: 'construction.stage@1',
  ruleSetVersion: RULE_SET_VERSION,
  namedField: null,
  reason: 'fixture',
  detail: null,
};
const held = async (id: string) => {
  await store.create(createTrancheRecord(definition(id)));
  await store.apply(id, 0, 'dispatch', cmd('dispatch', ['auth_fixture', 'K7Q', at, expiry]));
};
const pending = async (id: string) => {
  await held(id);
  await store.apply(id, 1, 'deciding', cmd('startDeciding'));
  return store.apply(id, 2, 'decision', cmd('beginSettlement', [release, 'decision_fixture', at]));
};
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
describe('Atomic tranche persistence', () => {
  it('persists possible submission before a fake provider call and never resubmits a confirmed key', async () => {
    const id = 'durable_execution';
    await pending(id);
    let calls = 0;
    const executor = {
      execute: async () => {
        calls++;
        expect((await store.load(id)).pending?.status).toBe('AMBIGUOUS');
        return {
          method: 'confirmSettlement',
          args: [{ effect: 'CAPTURE', authorizationId: 'auth_fixture', reference: 'fake_completed' }],
        } as const;
      },
    };
    expect(await executePayment(store, executor, id, randomUUID(), () => at)).toBe('RESOLVED');
    expect(await executePayment(store, executor, id, randomUUID(), () => at)).toBe('DONE');
    expect(calls).toBe(1);
    expect(restoreTrancheRecord((await store.load(id)).record).state).toBe('RELEASED');
  });
  it('recovers a provider success followed by an audit-write failure without another money call', async () => {
    const id = 'execution_audit_failure';
    const before = await pending(id);
    await pool.query(
      "CREATE FUNCTION reject_execution_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tranche_id = 'execution_audit_failure' AND NEW.status = 'CONFIRMED' THEN RAISE EXCEPTION 'Synthetic confirmation audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER reject_execution_confirmation BEFORE INSERT ON payment_operation_events FOR EACH ROW EXECUTE FUNCTION reject_execution_confirmation()",
    );
    const executor = {
      execute: async () =>
        ({
          method: 'confirmSettlement',
          args: [{ effect: 'CAPTURE', authorizationId: 'auth_fixture', reference: 'fake_capture' }],
        }) as const,
    };
    await expect(executePayment(store, executor, id, randomUUID(), () => at)).rejects.toThrow();
    expect((await store.load(id)).pending).toMatchObject({
      status: 'AMBIGUOUS',
      providerRequestId: before.pending?.providerRequestId,
    });
    expect(
      await executePayment(
        store,
        {
          execute: async () => {
            throw new Error('Must not resubmit');
          },
        },
        id,
        randomUUID(),
        () => at,
      ),
    ).toBe('WAIT');
    await pool.query('DROP TRIGGER reject_execution_confirmation ON payment_operation_events');
    expect(
      (
        await reconcile(
          store,
          {
            read: async () => ({
              complete: true,
              operationKey: before.pending?.operation.key,
              authorizationId: 'auth_fixture',
              providerRequestId: before.pending?.providerRequestId,
              reference: 'fake_capture',
              outcome: 'CAPTURED',
              noCapture: false,
              noRenewal: true,
              amount: { minor: 1000, currency: 'GBP' },
            }),
          },
          id,
          at,
        )
      ).status,
    ).toBe('RESOLVED');
    expect(restoreTrancheRecord((await store.load(id)).record).state).toBe('RELEASED');
  });
  it('returns a safe retry when concurrent expiry lookups carry different clocks', async () => {
    const id = 'provider_clock_race';
    await held(id);
    const before = await store.apply(id, 1, 'renew', cmd('beginReauthorization', [at + 3 * 86400000]));
    let readers = 0;
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = {
      read: async () => {
        if (++readers === 2) release?.();
        await barrier;
        return {
          complete: true,
          operationKey: before.pending?.operation.key,
          authorizationId: 'auth_fixture',
          providerRequestId: before.pending?.providerRequestId,
          reference: 'same_lookup',
          outcome: 'EXPIRED',
          noCapture: true,
          noRenewal: true,
        };
      },
    };
    const results = await Promise.all([reconcile(store, reader, id, expiry), reconcile(store, reader, id, expiry + 1)]);
    expect(results.map((result) => result.status).sort()).toEqual(['RESOLVED', 'RETRY']);
    expect((await store.load(id)).version).toBe(3);
    expect(restoreTrancheRecord((await store.load(id)).record).state).toBe('EXPIRED');
  });
  it('reconciles a capture from matched fake-provider proof atomically and reads no provider after settlement', async () => {
    const before = await pending('provider_capture');
    let reads = 0;
    const reader = {
      read: async () => {
        reads++;
        return {
          complete: true,
          operationKey: before.pending?.operation.key,
          authorizationId: 'auth_fixture',
          providerRequestId: before.pending?.providerRequestId,
          reference: 'fake_capture',
          outcome: 'CAPTURED',
          noCapture: false,
          noRenewal: true,
          amount: { minor: 1000, currency: 'GBP' },
        };
      },
    };
    expect((await reconcile(store, reader, 'provider_capture', at)).status).toBe('RESOLVED');
    expect(restoreTrancheRecord((await store.load('provider_capture')).record).state).toBe('RELEASED');
    expect((await reconcile(store, reader, 'provider_capture', at)).status).toBe('IDLE');
    expect(reads).toBe(1);
  });
  it.each(['EXPIRED', 'RENEWED'])(
    'resolves ambiguous renewal %s using fake provider and real atomic storage',
    async (outcome) => {
      const id = `provider_renewal_${outcome}`;
      await held(id);
      const before = await store.apply(id, 1, 'renew', cmd('beginReauthorization', [at + 3 * 86400000]));
      const unknown = await reconcile(store, { read: async () => ({ outcome: 'UNKNOWN' }) }, id, expiry);
      expect(unknown).toEqual({ status: 'WAIT', alert: true });
      expect(await store.load(id)).toEqual(before);
      const proof = {
        complete: true,
        operationKey: before.pending?.operation.key,
        authorizationId: 'auth_fixture',
        providerRequestId: before.pending?.providerRequestId,
        reference: 'fake_lookup',
        outcome,
        noCapture: true,
        noRenewal: outcome === 'EXPIRED',
        renewed: { authorizationId: 'renewed_fixture', confirmedAt: at + 3 * 86400000, expiresAt: expiry },
      };
      expect((await reconcile(store, { read: async () => proof }, id, expiry)).status).toBe('RESOLVED');
      const after = await store.load(id);
      if (outcome === 'EXPIRED') expect(restoreTrancheRecord(after.record).state).toBe('EXPIRED');
      else expect(after.pending?.operation).toMatchObject({ effect: 'VOID', authorizationId: 'renewed_fixture' });
    },
  );
  it('persists an old-rule safe cancellation and preserves its original header', async () => {
    const record = readFileSync(new URL('../../domain/fixtures/old-rule-held.json', import.meta.url), 'utf8');
    const first = await store.create(record);
    const cancel = await store.apply(first.trancheId, 0, 'cancel', cmd('cancel', [at]));
    expect(cancel.pending?.operation).toMatchObject({ effect: 'VOID', target: 'CANCELLED' });
    expect(restoreTrancheRecord(cancel.record).canSubmitPendingOperation).toBe(true);
    const confirmed = await store.apply(
      first.trancheId,
      1,
      'cancelled',
      cmd('confirmSettlement', [{ effect: 'VOID', authorizationId: 'auth_old', reference: 'void_old' }]),
    );
    expect(restoreTrancheRecord(confirmed.record).state).toBe('CANCELLED');
    expect(JSON.parse(confirmed.record).ruleSetVersion).toBe('1.0.0');
  });
  it('atomically expires an unresolved renewal only with matched no-renewal proof', async () => {
    await held('renewal_expired');
    const renewal = await store.apply('renewal_expired', 1, 'renew', cmd('beginReauthorization', [at + 3 * 86400000]));
    const expired = await store.apply(
      'renewal_expired',
      2,
      'expired',
      cmd('confirmNoRenewalExpiry', [
        { ...renewal.pending?.operation, kind: 'NO_RENEWAL_EXPIRED', reference: 'provider_expiry', now: expiry },
      ]),
    );
    expect(expired.pending).toBeNull();
    expect(restoreTrancheRecord(expired.record).settlement?.effect).toBe('EXPIRE');
  });
  it('rolls back a confirmation if its audit event fails', async () => {
    const before = await pending('outcome_rollback');
    await pool.query(
      "CREATE FUNCTION fail_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tranche_id = 'outcome_rollback' THEN RAISE EXCEPTION 'Synthetic outcome failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_confirmation BEFORE INSERT ON payment_operation_events FOR EACH ROW EXECUTE FUNCTION fail_confirmation()",
    );
    await expect(
      store.apply(
        'outcome_rollback',
        3,
        'confirm',
        cmd('confirmSettlement', [{ effect: 'CAPTURE', authorizationId: 'auth_fixture', reference: 'capture' }]),
      ),
    ).rejects.toThrow();
    expect(await store.load('outcome_rollback')).toEqual(before);
    await pool.query('DROP TRIGGER fail_confirmation ON payment_operation_events');
  });
  it('recovers pending state, operation UUID and history through a new connection', async () => {
    const first = await pending('restart');
    const freshPool = new pg.Pool(options);
    try {
      const fresh = new PostgresTranches(drizzle(freshPool, { schema }));
      expect(await fresh.load('restart')).toEqual(first);
      expect(restoreTrancheRecord(first.record).pendingOperation?.key).toBe(first.pending?.operation.key);
      expect(
        await fresh.apply('restart', 2, 'decision', cmd('beginSettlement', [release, 'decision_fixture', at])),
      ).toEqual(first);
    } finally {
      await freshPool.end();
    }
  });
  it('serialises competing domain transitions and rejects changed retries or stale versions', async () => {
    await held('race');
    const results = await Promise.allSettled([
      store.apply('race', 1, 'start', cmd('startDeciding')),
      store.apply('race', 1, 'renew', cmd('beginReauthorization', [at + 3 * 86400000])),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    await expect(store.apply('race', 0, 'stale', cmd('fundingFailed'))).rejects.toMatchObject({
      code: 'STALE_VERSION',
    });
    await pending('conflict');
    await expect(
      store.apply(
        'conflict',
        2,
        'decision',
        cmd('beginSettlement', [{ ...release, reason: 'changed' }, 'decision_fixture', at]),
      ),
    ).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
  });
  it.each(['payment_streams', 'tranche_commands', 'payment_operations', 'payment_operation_events'])(
    'rolls back all writes when %s fails',
    async (table) => {
      const id = `rollback_${table}`;
      await held(id);
      await store.apply(id, 1, 'start', cmd('startDeciding'));
      const before = await store.load(id);
      await pool.query(
        `CREATE FUNCTION fail_${table}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tranche_id = '${id}' THEN RAISE EXCEPTION 'Synthetic failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_${table} BEFORE ${table === 'payment_streams' ? 'UPDATE' : 'INSERT'} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_${table}()`,
      );
      await expect(
        store.apply(id, 2, 'decision', cmd('beginSettlement', [release, 'decision_fixture', at])),
      ).rejects.toThrow();
      expect(await store.load(id)).toEqual(before);
      expect(
        (await pool.query('SELECT count(*)::int AS count FROM tranche_commands WHERE tranche_id = $1', [id])).rows[0]
          .count,
      ).toBe(2);
      await pool.query(`DROP TRIGGER fail_${table} ON ${table}`);
      expect(
        (await store.apply(id, 2, 'decision', cmd('beginSettlement', [release, 'decision_fixture', at]))).pending,
      ).not.toBeNull();
    },
  );
  it('commits ambiguous and definite outcomes with counters and permits a fresh retry UUID', async () => {
    const first = await pending('outcomes');
    await store.apply(
      'outcomes',
      3,
      'ambiguous',
      cmd('settlementFailed', [{ effect: 'CAPTURE', authorizationId: 'auth_fixture', kind: 'AMBIGUOUS' }]),
    );
    const failed = await store.apply(
      'outcomes',
      4,
      'declined',
      cmd('settlementFailed', [
        { effect: 'CAPTURE', authorizationId: 'auth_fixture', kind: 'DECLINED', reference: 'provider_decline' },
      ]),
    );
    expect(failed.pending).toBeNull();
    const retry = await store.apply('outcomes', 5, 'retry', cmd('beginSettlement', [release, 'decision_retry', at]));
    expect(retry.pending?.providerRequestId).not.toBe(first.pending?.providerRequestId);
    const confirmed = await store.apply(
      'outcomes',
      6,
      'confirmed',
      cmd('confirmSettlement', [{ effect: 'CAPTURE', authorizationId: 'auth_fixture', reference: 'capture_fixture' }]),
    );
    expect(restoreTrancheRecord(confirmed.record).state).toBe('RELEASED');
    expect(confirmed.pending).toBeNull();
    await expect(
      new PostgresPaymentOperations(db).reserve('outcomes', 7, {
        key: 'bypass',
        effect: 'VOID',
        authorizationId: 'auth_fixture',
        target: 'REFUSED',
      }),
    ).rejects.toThrow('Aggregate-managed');
  });
  it('protects definition, rule header, version and prior history from direct rewrites', async () => {
    const snapshot = await pending('immutable');
    const document = JSON.parse(snapshot.record);
    for (const value of [
      { ...document, ruleSetVersion: 'future' },
      { ...document, commands: [] },
      { ...document, definition: definition('different') },
    ])
      await expect(
        pool.query('UPDATE payment_streams SET record = $1, version = version + 1 WHERE tranche_id = $2', [
          JSON.stringify(value),
          'immutable',
        ]),
      ).rejects.toThrow();
    await expect(pool.query("UPDATE payment_streams SET version = 0 WHERE tranche_id = 'immutable'")).rejects.toThrow();
    for (const statement of [
      'UPDATE tranche_commands SET command = NULL',
      'DELETE FROM tranche_commands',
      'TRUNCATE tranche_commands',
    ])
      await expect(pool.query(statement)).rejects.toThrow('Payment history is append-only');
  });
  it('handles missing/invalid commands and idempotent creation without writes', async () => {
    await expect(store.load('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(store.apply('missing', 0, 'key', cmd('fundingFailed'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const record = createTrancheRecord(definition('create'));
    expect(await store.create(record)).toEqual(await store.create(record));
    await expect(store.create(createTrancheRecord({ ...definition('create'), maxResubmits: 2 }))).rejects.toMatchObject(
      { code: 'IDENTITY_CONFLICT' },
    );
    await expect(store.apply('create', -1, 'key', cmd('fundingFailed'))).rejects.toMatchObject({
      code: 'INVALID_COMMAND',
    });
    await expect(store.apply('create', 0, '', cmd('fundingFailed'))).rejects.toMatchObject({ code: 'INVALID_COMMAND' });
    await expect(store.apply('create', 0, 'illegal', cmd('dispute'))).rejects.toThrow();
    expect((await store.load('create')).version).toBe(0);
  });
});

it('claims one retry across competing real-Postgres workers and retains consumption after restart', async () => {
  const id = 'bounded_retry_race';
  await pending(id);
  await executePayment(
    store,
    {
      execute: async () => {
        throw new Error('not sent');
      },
    },
    id,
    'first',
    () => at,
  );
  const before = await store.load(id);
  const proof = {
    complete: true,
    outcome: 'NOT_CAPTURED',
    noCapture: true,
    noRenewal: true,
    capturable: true,
    operationKey: before.pending!.operation.key,
    authorizationId: 'auth_fixture',
    providerRequestId: before.pending!.providerRequestId,
    reference: 'matched_lookup',
    observedAt: at,
    expiresAt: expiry,
    amount: { minor: 1000, currency: 'GBP' },
  };
  const restartedPool = new pg.Pool(options);
  try {
    const restarted = new PostgresTranches(drizzle(restartedPool, { schema }));
    let calls = 0;
    const executor = {
      execute: async () => {
        calls++;
        throw new Error('lost reply');
      },
    };
    let reads = 0,
      release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reader = {
      read: async () => {
        if (++reads === 2) release();
        await barrier;
        return proof;
      },
    };
    await Promise.all([
      retryCapture(store, reader, executor, id, 'same-worker', () => at),
      retryCapture(restarted, reader, executor, id, 'same-worker', () => at),
    ]);
    expect(calls).toBe(1);
    const after = await restarted.load(id);
    expect(after.pending?.providerRequestId).toBe(before.pending?.providerRequestId);
    expect(restoreTrancheRecord(after.record).captureRetryClaim).toMatchObject({ reference: 'matched_lookup' });
    expect(await retryCapture(restarted, { read: async () => proof }, executor, id, 'restart', () => at)).toBe('WAIT');
    expect(calls).toBe(1);
    const history = await new PostgresPaymentOperations(drizzle(restartedPool, { schema })).history(id);
    expect(history.map((e) => e.status)).toEqual(['RESERVED', 'AMBIGUOUS', 'AMBIGUOUS']);
  } finally {
    await restartedPool.end();
  }
});
it('does not call PayPal if the process loses the response after committing retry consumption', async () => {
  const id = 'bounded_retry_crash';
  await pending(id);
  await executePayment(store, { execute: async () => null }, id, 'first', () => at);
  const before = await store.load(id);
  const proof = {
    complete: true,
    outcome: 'NOT_CAPTURED',
    noCapture: true,
    noRenewal: true,
    capturable: true,
    operationKey: before.pending!.operation.key,
    authorizationId: 'auth_fixture',
    providerRequestId: before.pending!.providerRequestId,
    reference: 'matched_lookup',
    observedAt: at,
    expiresAt: expiry,
    amount: { minor: 1000, currency: 'GBP' },
  };
  let calls = 0;
  const executor = {
    execute: async () => {
      calls++;
      return null;
    },
  };
  const crashing = {
    create: store.create.bind(store),
    load: store.load.bind(store),
    apply: async (...args: Parameters<typeof store.apply>) => {
      await store.apply(...args);
      throw new Error('process stopped');
    },
  };
  await expect(retryCapture(crashing, { read: async () => proof }, executor, id, 'crash', () => at)).rejects.toThrow(
    'process stopped',
  );
  expect(calls).toBe(0);
  expect(await retryCapture(store, { read: async () => proof }, executor, id, 'restart', () => at)).toBe('WAIT');
  expect(calls).toBe(0);
  expect(restoreTrancheRecord((await store.load(id)).record).captureRetryClaim).not.toBeNull();
});

it('does not submit twice when two invocations reuse the same initial worker identity', async () => {
  const id = 'initial_same_worker';
  await pending(id);
  let reads = 0,
    release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const racing = {
    create: store.create.bind(store),
    apply: store.apply.bind(store),
    load: async (id: string) => {
      const value = await store.load(id);
      if (++reads === 2) release();
      await barrier;
      return value;
    },
  };
  let calls = 0;
  const executor = {
    execute: async () => {
      calls++;
      return null;
    },
  };
  await Promise.all([
    executePayment(racing, executor, id, 'same-worker', () => at),
    executePayment(racing, executor, id, 'same-worker', () => at),
  ]);
  expect(calls).toBe(1);
  expect((await store.load(id)).pending?.status).toBe('AMBIGUOUS');
});
