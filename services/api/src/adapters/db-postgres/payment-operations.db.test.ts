import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentOperation, ReauthorizationOperation } from '../../domain/tranche.js';
import { PostgresPaymentOperations } from './payment-operations.js';
import * as schema from './schema.js';

// Fixed Compose-only destination; never consume an arbitrary developer DATABASE_URL.
const connectionString = 'postgres://stood:stood_local_only@db:5432/stood';
const databaseName = `test_payments_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString });
const options = {
  connectionString: `postgres://stood:stood_local_only@db:5432/${databaseName}`,
  options: '-c statement_timeout=5000',
};
const pool = new pg.Pool(options);
const database = drizzle(pool, { schema });
const store = new PostgresPaymentOperations(database);
const migrations = { migrationsFolder: resolve('services/api/drizzle') };
const capture = (key: string): PaymentOperation => ({
  key,
  effect: 'CAPTURE',
  authorizationId: 'auth_fixture',
  target: 'RELEASED',
});
const voiding = (key: string): PaymentOperation => ({
  key,
  effect: 'VOID',
  authorizationId: 'auth_fixture',
  target: 'REFUSED',
});
const renewal = (key: string): ReauthorizationOperation => ({
  key,
  effect: 'REAUTHORIZE',
  authorizationId: 'auth_fixture',
  requestedAt: 1790985600000,
  previousState: 'HELD',
});

beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${databaseName}`);
  await migrate(database, migrations);
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${databaseName}`);
  await admin.end();
});

describe('Durable payment operation ledger (local Postgres)', () => {
  it('keeps a request UUID across a new database connection and migration replay', async () => {
    await store.createStream('restart');
    const operation = capture('restart_capture');
    const first = await store.reserve('restart', 0, operation);
    expect(first.providerRequestId).toMatch(/^[0-9a-f-]{36}$/);
    const freshPool = new pg.Pool(options);
    try {
      const freshDatabase = drizzle(freshPool, { schema });
      await migrate(freshDatabase, migrations);
      const freshStore = new PostgresPaymentOperations(freshDatabase);
      expect(await freshStore.reserve('restart', 0, operation)).toEqual(first);
      expect(await freshStore.load('restart', operation.key)).toEqual(first);
      expect(await freshStore.load('restart', 'missing')).toBeNull();
    } finally {
      await freshPool.end();
    }
  });
  it('allows only one of competing capture, void and renewal reservations', async () => {
    await store.createStream('race');
    const results = await Promise.allSettled(
      [capture('race_capture'), voiding('race_void'), renewal('race_renew')].map((operation) =>
        store.reserve('race', 0, operation),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await store.history('race')).toHaveLength(1);
  });
  it('gives simultaneous identical retries one request UUID and one history record', async () => {
    await store.createStream('retry');
    const results = await Promise.all(
      Array.from({ length: 10 }, () => store.reserve('retry', 0, capture('retry_capture'))),
    );
    expect(new Set(results.map((result) => result.providerRequestId)).size).toBe(1);
    expect(await store.history('retry')).toHaveLength(1);
    await expect(
      store.reserve('retry', 0, { ...capture('retry_capture'), authorizationId: 'different' }),
    ).rejects.toThrow('Operation identity conflict');
    await expect(store.reserve('retry', 1, capture('retry_capture'))).rejects.toThrow('Operation identity conflict');
  });
  it('retains ambiguous reservations and appends history before permitting a definite retry', async () => {
    await store.createStream('outcomes');
    const first = await store.reserve('outcomes', 0, capture('outcome_first'));
    const ambiguous = await store.recordOutcome('outcomes', 1, first.operation.key, 'AMBIGUOUS', null);
    expect(ambiguous.providerRequestId).toBe(first.providerRequestId);
    await expect(store.reserve('outcomes', 2, voiding('conflicting_void'))).rejects.toThrow(
      'Unresolved payment operation',
    );
    expect(await store.recordOutcome('outcomes', 1, first.operation.key, 'AMBIGUOUS', null)).toEqual(ambiguous);
    const failed = await store.recordOutcome('outcomes', 2, first.operation.key, 'FAILED', 'provider_decline');
    expect(await store.recordOutcome('outcomes', 2, first.operation.key, 'FAILED', 'provider_decline')).toEqual(failed);
    const retry = await store.reserve('outcomes', 3, capture('outcome_retry'));
    expect(retry.providerRequestId).not.toBe(first.providerRequestId);
    const confirmed = await store.recordOutcome('outcomes', 4, retry.operation.key, 'CONFIRMED', 'capture_completed');
    expect(confirmed.status).toBe('CONFIRMED');
    expect((await store.history('outcomes')).map((event) => event.status)).toEqual([
      'RESERVED',
      'AMBIGUOUS',
      'FAILED',
      'RESERVED',
      'CONFIRMED',
    ]);
    await expect(store.recordOutcome('outcomes', 5, retry.operation.key, 'FAILED', 'contradiction')).rejects.toThrow(
      'Operation already resolved',
    );
  });
  it('rejects stale versions, changed targets and malformed commands without writes', async () => {
    await store.createStream('invalid');
    await store.createStream('invalid');
    await expect(store.reserve('unknown', 0, capture('unknown_key'))).rejects.toThrow('Unknown payment stream');
    await expect(store.reserve('invalid', 1, capture('stale'))).rejects.toThrow('Stale payment version');
    for (const operation of [
      capture(''),
      { ...capture('bad'), authorizationId: '' },
      { ...capture('bad'), target: 'EXPIRED' },
      { ...renewal('bad'), requestedAt: Number.NaN },
      { ...renewal('bad'), previousState: 'PENDING' },
      { ...capture('bad'), effect: 'UNKNOWN' },
    ])
      await expect(store.reserve('invalid', 0, operation as PaymentOperation)).rejects.toThrow();
    await expect(store.reserve('invalid', -1, capture('bad'))).rejects.toThrow();
    expect(await store.history('invalid')).toHaveLength(0);
    await store.reserve('invalid', 0, voiding('valid_void'));
    await expect(store.reserve('invalid', 0, { ...voiding('valid_void'), target: 'EXPIRED' })).rejects.toThrow(
      'Operation identity conflict',
    );
    await expect(store.recordOutcome('invalid', 0, 'valid_void', 'CONFIRMED', 'ref')).rejects.toThrow(
      'Stale payment version',
    );
    await expect(store.recordOutcome('invalid', 1, 'missing', 'CONFIRMED', 'ref')).rejects.toThrow(
      'Unknown payment operation',
    );
    await expect(store.recordOutcome('invalid', 1, 'valid_void', 'CONFIRMED', '')).rejects.toThrow();
    await expect(store.recordOutcome('invalid', 1, 'valid_void', 'UNKNOWN' as 'CONFIRMED', 'ref')).rejects.toThrow();
  });
  it('rolls back reservation and version if writing its audit event fails', async () => {
    await store.createStream('rollback');
    await pool.query(
      `CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.tranche_id = 'rollback' THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END; $$; CREATE TRIGGER fail_audit BEFORE INSERT ON payment_operation_events FOR EACH ROW EXECUTE FUNCTION fail_audit()`,
    );
    await expect(store.reserve('rollback', 0, capture('rollback_key'))).rejects.toThrow();
    expect(await store.load('rollback', 'rollback_key')).toBeNull();
    expect(await store.history('rollback')).toEqual([]);
    await pool.query('DROP TRIGGER fail_audit ON payment_operation_events');
    expect((await store.reserve('rollback', 0, capture('rollback_key'))).version).toBe(1);
  });
  it('serialises competing outcomes without overwriting the winner', async () => {
    await store.createStream('outcome_race');
    await store.reserve('outcome_race', 0, capture('outcome_race_key'));
    const outcomes = await Promise.allSettled(
      ['CONFIRMED', 'FAILED'].map((status) =>
        store.recordOutcome(
          'outcome_race',
          1,
          'outcome_race_key',
          status as 'CONFIRMED' | 'FAILED',
          `provider_${status}`,
        ),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    for (const outcome of outcomes)
      if (outcome.status === 'rejected') expect(outcome.reason.message).toBe('Operation already resolved');
    expect(await store.history('outcome_race')).toHaveLength(2);
  });
});
