import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { FaultController } from '../../../../simulators/src/faults.js';
import { simulatorServer } from '../../../test/contracts/paypal-simulator.js';
import { advanceFunding } from '../../application/funding.js';
import { createTrancheRecord, restoreTrancheRecord } from '../../domain/tranche-record.js';
import { PayPalFundingAdapter } from '../payments-paypal/funding.js';
import { PostgresFunding } from './funding.js';
import { PostgresPlatformApi } from './platform-api.js';
import * as schema from './schema.js';
import { PostgresTranches } from './tranches.js';

const name = `test_funding_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const options = {
  connectionString: `postgres://stood:stood_local_only@db:5432/${name}`,
  options: '-c statement_timeout=5000',
};
const pool = new pg.Pool(options);
const db = drizzle(pool, { schema });
const store = new PostgresFunding(db);
const now = 1791244800000;
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
async function setup() {
  const key = randomUUID();
  const draft = await new PostgresPlatformApi(db).create('buyer-platform', key, 'a'.repeat(64), {
    payee_ref: 'sandbox-payee',
    cap: { minor: 1000, currency: 'USD' },
    milestones: [{ name: 'Build', amount: { minor: 1000, currency: 'USD' }, profile: 'code.milestone@1', params: {} }],
    window_days: 7,
    max_resubmits: 1,
  });
  return {
    key,
    trancheId: draft.tranches[0]!.id,
    platformId: 'buyer-platform',
    expectedVersion: 0,
    nonce: 'K7Q',
    mode: 'sim' as const,
  };
}
async function authorizing() {
  const input = await setup();
  const reserved = await store.reserve(input);
  await store.beginCreate(input.key, reserved.version);
  await store.orderCreated(input.key, {
    orderId: `ORDER-${input.key}`,
    approvalUrl: `http://paypal-sim:8080/__sim/approve/ORDER-${input.key}`,
  });
  await store.beginAuthorize(input.key, 2);
  return input;
}
const proof = (key: string) => ({
  orderId: `ORDER-${key}`,
  authorizationId: `AUTH-${key}`,
  heldAt: now,
  expiresAt: now + 29 * 86400000,
  reference: `ORDER-${key}:AUTH-${key}`,
});

it('reserves independent provider IDs before submission and restores exact retries across connections', async () => {
  const input = await setup();
  const reserved = await store.reserve(input);
  expect(reserved.status).toBe('RESERVED');
  expect(reserved.createRequestId).not.toBe(reserved.authorizeRequestId);
  const other = new pg.Pool(options);
  try {
    const restored = new PostgresFunding(drizzle(other, { schema }));
    expect(await restored.reserve(input)).toEqual(reserved);
    await expect(restored.reserve({ ...input, nonce: 'J8R' })).rejects.toThrow('IDENTITY_CONFLICT');
  } finally {
    await other.end();
  }
  expect((await store.events(input.key)).map((e) => e.status)).toEqual(['RESERVED']);
});
it('serialises competing reservations and refuses another platform', async () => {
  const input = await setup();
  await expect(store.reserve({ ...input, platformId: 'stranger' })).rejects.toThrow('NOT_FOUND');
  const results = await Promise.allSettled([store.reserve(input), store.reserve({ ...input, key: randomUUID() })]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
});
it('records possible create/authorize submission and only permits one concurrent invoker', async () => {
  const input = await setup();
  await store.reserve(input);
  const results = await Promise.allSettled([store.beginCreate(input.key, 0), store.beginCreate(input.key, 0)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await store.load(input.key)).status).toBe('CREATING');
  await expect(store.beginAuthorize(input.key, 1)).rejects.toThrow('CONFLICT');
  const order = {
    orderId: `ORDER-${input.key}`,
    approvalUrl: `http://paypal-sim:8080/__sim/approve/ORDER-${input.key}`,
  };
  await store.orderCreated(input.key, order);
  await store.beginAuthorize(input.key, 2);
  expect(await store.orderCreated(input.key, order)).toMatchObject({ status: 'AUTHORIZING' });
  expect((await store.events(input.key)).map((e) => e.status)).toEqual([
    'RESERVED',
    'CREATING',
    'AWAITING_APPROVAL',
    'AUTHORIZING',
  ]);
  expect(restoreTrancheRecord((await new PostgresTranches(db).load(input.trancheId)).record).state).toBe('PENDING');
});
it('commits the confirmed hold and funding outcome together and treats exact callbacks as reads', async () => {
  const input = await authorizing();
  const result = await store.confirm(input.key, proof(input.key));
  expect(result.status).toBe('HELD');
  const tranche = restoreTrancheRecord((await new PostgresTranches(db).load(input.trancheId)).record);
  expect(tranche.state).toBe('HELD');
  expect(tranche.currentHold.authorizationId).toBe(`AUTH-${input.key}`);
  expect(await store.confirm(input.key, proof(input.key))).toEqual(result);
  await expect(store.confirm(input.key, { ...proof(input.key), authorizationId: 'different' })).rejects.toThrow(
    'IDENTITY_CONFLICT',
  );
  await expect(store.reserve({ ...input, key: randomUUID(), expectedVersion: 1 })).rejects.toThrow('CONFLICT');
  expect((await store.events(input.key)).map((e) => e.status)).toEqual([
    'RESERVED',
    'CREATING',
    'AWAITING_APPROVAL',
    'AUTHORIZING',
    'HELD',
  ]);
});
it('rolls back the hold, tranche journal and funding outcome when its audit event fails', async () => {
  const input = await authorizing();
  await pool.query(
    `CREATE FUNCTION reject_funding_event_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key = '${input.key}' AND NEW.status = 'HELD' THEN RAISE EXCEPTION 'injected event failure'; END IF; RETURN NEW; END $$`,
  );
  await pool.query(
    'CREATE TRIGGER reject_funding_event_test BEFORE INSERT ON funding_events FOR EACH ROW EXECUTE FUNCTION reject_funding_event_test()',
  );
  try {
    await expect(store.confirm(input.key, proof(input.key))).rejects.toMatchObject({
      cause: { message: 'injected event failure' },
    });
    expect((await store.load(input.key)).status).toBe('AUTHORIZING');
    const tranche = await new PostgresTranches(db).load(input.trancheId);
    expect(tranche.version).toBe(0);
    expect(restoreTrancheRecord(tranche.record).state).toBe('PENDING');
    expect((await store.events(input.key)).at(-1)?.status).toBe('AUTHORIZING');
  } finally {
    await pool.query('DROP TRIGGER reject_funding_event_test ON funding_events');
  }
});
it('blocks direct dispatch while funding is unresolved and rejects mismatched order or unsafe approval links', async () => {
  const input = await authorizing();
  await expect(store.confirm(input.key, { ...proof(input.key), orderId: 'different' })).rejects.toThrow(
    'IDENTITY_CONFLICT',
  );
  await expect(
    new PostgresTranches(db).apply(input.trancheId, 0, 'bypass', {
      method: 'dispatch',
      args: ['other', 'K7Q', now, now + 10000],
    }),
  ).rejects.toThrow('IDENTITY_CONFLICT');
  const other = await setup();
  await store.reserve(other);
  await store.beginCreate(other.key, 0);
  await expect(
    store.orderCreated(other.key, { orderId: 'ORDER', approvalUrl: 'https://attacker.example/' }),
  ).rejects.toThrow('INVALID');
  expect((await store.load(other.key)).status).toBe('CREATING');
});
it('records a definite funding refusal with WAIT_FUNDING atomically without inventing a hold', async () => {
  const input = await authorizing();
  const failed = await store.fail(input.key, 'provider-debug-reference');
  expect(failed.status).toBe('FAILED');
  expect(await store.fail(input.key, 'provider-debug-reference')).toEqual(failed);
  expect(restoreTrancheRecord((await new PostgresTranches(db).load(input.trancheId)).record).state).toBe(
    'WAIT_FUNDING',
  );
  await expect(store.confirm(input.key, proof(input.key))).rejects.toThrow('CONFLICT');
});

it('rejects malformed reservations and proofs before creating a hold or changing history', async () => {
  const input = await setup();
  for (const patch of [{ key: '' }, { expectedVersion: -1 }, { mode: 'production' }, { nonce: '***' }, { paid: true }])
    await expect(store.reserve({ ...input, ...patch } as typeof input)).rejects.toThrow('INVALID');
  await expect(store.reserve({ ...input, expectedVersion: 1 })).rejects.toThrow('STALE_VERSION');
  await expect(store.load('missing')).rejects.toThrow('NOT_FOUND');
  await expect(store.beginCreate('missing', 0)).rejects.toThrow('NOT_FOUND');
  await expect(store.beginCreate('', 0)).rejects.toThrow('INVALID');
  const active = await authorizing();
  for (const patch of [{ expiresAt: now }, { heldAt: -1 }, { reference: '' }, { authorizationId: '' }, { paid: true }])
    await expect(store.confirm(active.key, { ...proof(active.key), ...patch })).rejects.toThrow('INVALID');
  expect((await store.load(active.key)).version).toBe(3);
  const unrelated = await setup();
  await expect(store.reserve({ ...unrelated, key: active.key })).rejects.toThrow('IDENTITY_CONFLICT');
});

it('protects reservation identity, monotonic phases, server time and append-only events at the database boundary', async () => {
  const input = await setup();
  const row = await store.reserve(input);
  for (const [column, value] of [
    ['create_request_id', randomUUID()],
    ['instruction', '{}'],
    ['created_at', '2000-01-01'],
    ['status', 'HELD'],
  ] as const)
    await expect(
      pool.query(`UPDATE funding_operations SET ${column} = $1, version = version + 1 WHERE key = $2`, [
        value,
        input.key,
      ]),
    ).rejects.toThrow();
  await expect(
    pool.query('UPDATE funding_operations SET status = $1 WHERE key = $2', ['CREATING', input.key]),
  ).rejects.toThrow();
  await expect(
    pool.query('UPDATE funding_operations SET status = $1, version = version + 1 WHERE key = $2', [
      'CREATING',
      input.key,
    ]),
  ).rejects.toThrow('atomic audit');
  await expect(
    pool.query('UPDATE funding_events SET status = $1 WHERE key = $2', ['CREATING', input.key]),
  ).rejects.toThrow();
  await expect(pool.query('DELETE FROM funding_operations WHERE key = $1', [input.key])).rejects.toThrow();
  await expect(pool.query('DELETE FROM funding_events WHERE key = $1', [input.key])).rejects.toThrow();
  await expect(
    pool.query('INSERT INTO funding_events(key,version,status,reference) VALUES ($1,1,$2,$3)', [
      input.key,
      'HELD',
      'invented',
    ]),
  ).rejects.toThrow();
  expect((await store.load(input.key)).createdAt).toBe(row.createdAt);
  expect(await store.events(input.key)).toHaveLength(1);
});

it('database inserts cannot skip reservation and settlements cannot bypass unresolved funding', async () => {
  const input = await setup();
  await store.reserve(input);
  await expect(
    pool.query(
      `INSERT INTO funding_operations(key,tranche_id,instruction,version,status,create_request_id,authorize_request_id,reference) VALUES ($1,$2,$3,0,'FAILED',$4,$5,'invented')`,
      [randomUUID(), input.trancheId, JSON.stringify({ ...input, key: 'invalid' }), randomUUID(), randomUUID()],
    ),
  ).rejects.toThrow('start with a reservation');
  await expect(
    pool.query(
      `INSERT INTO payment_operations(key,tranche_id,operation,provider_request_id,status,reserved_from_version,version) VALUES ($1,$2,$3,$4,'RESERVED',0,1)`,
      [
        'fake-operation',
        input.trancheId,
        JSON.stringify({ key: 'fake-operation', effect: 'CAPTURE', authorizationId: 'fake', target: 'RELEASED' }),
        randomUUID(),
      ],
    ),
  ).rejects.toThrow('conflicts with unresolved funding');
});

it('validates approval URLs and stale transitions without allowing an order identity to change', async () => {
  const input = await setup();
  await store.reserve(input);
  await expect(store.beginCreate(input.key, 1)).rejects.toThrow('STALE_VERSION');
  await store.beginCreate(input.key, 0);
  for (const approvalUrl of [
    'not a URL',
    'http://paypal-sim:8080/__sim/approve/ORDER#secret',
    'http://paypal-sim:8080/__sim/approve/ORDER?token=secret',
    'http://user:password@paypal-sim:8080/__sim/approve/ORDER',
    'http://paypal-sim:8080/__sim/approve/ANOTHER-ORDER',
  ])
    await expect(store.orderCreated(input.key, { orderId: 'ORDER', approvalUrl })).rejects.toThrow('INVALID');
  await expect(
    store.orderCreated(input.key, { orderId: '', approvalUrl: 'http://paypal-sim:8080/__sim/approve/ORDER' }),
  ).rejects.toThrow('INVALID');
  await store.orderCreated(input.key, {
    orderId: `ORDER-${input.key}`,
    approvalUrl: `http://paypal-sim:8080/__sim/approve/ORDER-${input.key}`,
  });
  await expect(
    store.orderCreated(input.key, { orderId: 'changed', approvalUrl: 'http://paypal-sim:8080/__sim/approve/changed' }),
  ).rejects.toThrow('IDENTITY_CONFLICT');
  await expect(store.fail(input.key, 'provider-reference')).rejects.toThrow('CONFLICT');
  await expect(store.fail(input.key, '')).rejects.toThrow('INVALID');
  await expect(store.confirm(input.key, proof(input.key))).rejects.toThrow('CONFLICT');
});

it('resolves an old-rule funding fixture into a cancellable safe hold and refuses new funding on old rules', async () => {
  const source = await setup();
  const sourceRow = await store.reserve(source);
  const trancheId = `old-${randomUUID()}`,
    key = randomUUID();
  const record = JSON.stringify({
    ...JSON.parse(
      createTrancheRecord({
        id: trancheId,
        amount: { minor: 1000, currency: 'USD' },
        profileId: 'code.milestone@1',
        maxResubmits: 1,
      }),
    ),
    ruleSetVersion: '1.0.0',
  });
  await new PostgresTranches(db).create(record);
  await pool.query('INSERT INTO api_tranche_owners(tranche_id,allowance_id,platform_id) VALUES ($1,$2,$3)', [
    trancheId,
    sourceRow.instruction.allowanceId,
    source.platformId,
  ]);
  const reservation = { ...source, key, trancheId };
  await expect(store.reserve(reservation)).rejects.toThrow('CONFLICT');
  // A historical writer reserved this before the rules changed. Its insert
  // still starts RESERVED with an event; no resolved fixture is invented.
  await db.transaction(async (tx) => {
    await tx.insert(schema.fundingOperations).values({
      key,
      trancheId,
      instruction: { ...sourceRow.instruction, key, trancheId },
      status: 'RESERVED',
      createRequestId: randomUUID(),
      authorizeRequestId: randomUUID(),
    });
    await tx.insert(schema.fundingEvents).values({ key, version: 0, status: 'RESERVED' });
  });
  await store.beginCreate(key, 0);
  await store.orderCreated(key, {
    orderId: `ORDER-${key}`,
    approvalUrl: `http://paypal-sim:8080/__sim/approve/ORDER-${key}`,
  });
  await store.beginAuthorize(key, 2);
  await store.confirm(key, proof(key));
  const recovered = await new PostgresTranches(db).load(trancheId);
  expect(restoreTrancheRecord(recovered.record).safeRecovery).toBe(true);
  await expect(
    new PostgresTranches(db).apply(trancheId, 1, 'capture', { method: 'startDeciding', args: [] }),
  ).rejects.toThrow('Safe recovery');
  const cancelled = await new PostgresTranches(db).apply(trancheId, 1, 'cancel', { method: 'cancel', args: [now] });
  expect(cancelled.pending?.operation.effect).toBe('VOID');
});

it.each([0, 29])(
  'recovers a lost SDK authorisation after %i days and store restart, with one simulator hold',
  async (days) => {
    const simulatorOrderId = days === 29 ? 'SIM-ORDER-2' : 'SIM-ORDER-1';
    const faults = new FaultController([
      { method: 'POST', path: `/v2/checkout/orders/${simulatorOrderId}/authorize`, kind: 'LOST_RESPONSE' },
    ]);
    const h = await simulatorServer(faults);
    const connection = new pg.Pool(options);
    try {
      // Independent simulators reset their disposable ID sequence. This database
      // deliberately retains history across cases, so reserve a different ID for
      // the second provider fixture. The unused order is never approved or held.
      if (days === 29)
        await h.transport.fund('CREATE_ORDER', {
          mode: 'sim',
          orderId: null,
          requestId: randomUUID(),
          operationKey: 'unused-order',
          trancheId: 'unused-tranche',
          payeeRef: 'sandbox-payee',
          amount: { currencyCode: 'USD', value: '10.00' },
        });
      const input = await setup();
      await store.reserve(input);
      const provider = new PayPalFundingAdapter(h.transport),
        authority = { canFund: async () => true };
      let observedAt = Date.parse('2026-10-05T00:00:00Z');
      const clock = () => observedAt;
      expect(await advanceFunding(store, new PostgresTranches(db), provider, authority, input.key, clock)).toBe(
        'AWAITING_APPROVAL',
      );
      const order = await store.load(input.key);
      expect(order.orderId).toBe(simulatorOrderId);
      expect(
        (
          await fetch(`${h.baseUrl}/__sim/approve/${order.orderId}`, {
            method: 'POST',
            headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).ok,
      ).toBe(true);
      expect(await advanceFunding(store, new PostgresTranches(db), provider, authority, input.key, clock)).toBe('WAIT');
      expect((await store.load(input.key)).status).toBe('AUTHORIZING');
      h.advance(days);
      observedAt += days * 86400000;
      const expected = days === 29 ? 'EXPIRED' : 'HELD';
      const recoveredDb = drizzle(connection, { schema }),
        recovered = new PostgresFunding(recoveredDb);
      expect(
        await advanceFunding(
          recovered,
          new PostgresTranches(recoveredDb),
          provider,
          { canFund: async () => false },
          input.key,
          clock,
        ),
      ).toBe(expected);
      expect(
        await advanceFunding(recovered, new PostgresTranches(recoveredDb), provider, authority, input.key, clock),
      ).toBe(expected);
      const lookup = await h.transport.fund('GET_FUNDING_ORDER', {
        mode: 'sim',
        orderId: order.orderId,
        requestId: order.authorizeRequestId,
        operationKey: input.key,
        trancheId: input.trancheId,
        payeeRef: 'sandbox-payee',
        amount: { currencyCode: 'USD', value: '10.00' },
      });
      expect(lookup.body).toMatchObject({
        purchase_units: [{ payments: { authorizations: [expect.any(Object)], captures: [] } }],
      });
      const units = (lookup.body as { purchase_units: { payments: { authorizations: unknown[] } }[] }).purchase_units;
      expect(units[0]!.payments.authorizations).toHaveLength(1);
      expect((await recovered.events(input.key)).map((e) => e.status)).toEqual([
        'RESERVED',
        'CREATING',
        'AWAITING_APPROVAL',
        'AUTHORIZING',
        expected,
      ]);
    } finally {
      await connection.end();
      await h.close();
    }
  },
);
it('atomically resolves proven initial funding expiry without a settlement reservation or a second hold', async () => {
  const input = await authorizing(),
    hold = proof(input.key);
  await expect(store.expire(input.key, hold, hold.expiresAt - 1)).rejects.toThrow('INVALID');
  await expect(store.expire(input.key, hold, NaN)).rejects.toThrow('INVALID');
  const resolved = await store.expire(input.key, hold, hold.expiresAt);
  expect(resolved.status).toBe('EXPIRED');
  const tranche = await new PostgresTranches(db).load(input.trancheId);
  expect(restoreTrancheRecord(tranche.record).state).toBe('EXPIRED');
  expect(restoreTrancheRecord(tranche.record).settlement).toMatchObject({
    effect: 'EXPIRE',
    reference: hold.reference,
  });
  expect(tranche.pending).toBeNull();
  expect(await store.expire(input.key, hold, hold.expiresAt + 1)).toEqual(resolved);
  expect((await store.events(input.key)).at(-1)?.status).toBe('EXPIRED');
});
