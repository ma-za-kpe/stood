import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getTableConfig } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OperationIntent } from '../../ports/payment-operation-store.js';
import * as schema from './schema.js';

// Fixed Compose-only destination; never consume an arbitrary developer DATABASE_URL.
const databaseName = `test_payments_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const options = {
  connectionString: `postgres://stood:stood_local_only@db:5432/${databaseName}`,
  options: '-c statement_timeout=5000',
};
const pool = new pg.Pool(options);
const db = drizzle(pool, { schema });
const migrations = { migrationsFolder: resolve('services/api/drizzle') };
const row = (trancheId: string, key: string, effect: OperationIntent['effect'] = 'CAPTURE') => ({
  trancheId,
  key,
  providerRequestId: randomUUID(),
  status: 'RESERVED' as const,
  reservedFromVersion: 0,
  version: 1,
  operation:
    effect === 'REAUTHORIZE'
      ? { key, effect, authorizationId: 'auth_fixture', requestedAt: 1790985600000, previousState: 'HELD' as const }
      : { key, effect, authorizationId: 'auth_fixture', target: 'RELEASED' as const },
});
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${databaseName}`);
  await migrate(db, migrations);
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${databaseName}`);
  await admin.end();
});

describe('Payment schema (real local Postgres)', () => {
  it('replays forward migrations and retains the request UUID through a new connection', async () => {
    await db.insert(schema.paymentStreams).values({ trancheId: 'reload' });
    const intent = row('reload', 'reload_capture');
    await db.insert(schema.paymentOperations).values(intent);
    const freshPool = new pg.Pool(options);
    try {
      const fresh = drizzle(freshPool);
      await migrate(fresh, migrations);
      const [loaded] = await fresh
        .select()
        .from(schema.paymentOperations)
        .where(eq(schema.paymentOperations.key, intent.key));
      expect(loaded).toMatchObject(intent);
    } finally {
      await freshPool.end();
    }
  });
  it('allows one unresolved capture, void or renewal per tranche under concurrent inserts', async () => {
    await db.insert(schema.paymentStreams).values({ trancheId: 'race' });
    const results = await Promise.allSettled(
      ['CAPTURE', 'VOID', 'REAUTHORIZE'].map((effect) =>
        db.insert(schema.paymentOperations).values(row('race', `race_${effect}`, effect as OperationIntent['effect'])),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results)
      if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ cause: { code: '23505', constraint: 'one_unresolved_payment' } });
    await db
      .update(schema.paymentOperations)
      .set({ status: 'AMBIGUOUS', version: 2 })
      .where(eq(schema.paymentOperations.trancheId, 'race'));
    await expect(db.insert(schema.paymentOperations).values(row('race', 'race_late'))).rejects.toMatchObject({
      cause: { constraint: 'one_unresolved_payment' },
    });
  });
  it('rejects duplicate UUIDs, missing identity, invalid effects and absent confirmation references', async () => {
    for (const trancheId of ['valid', 'invalid']) await db.insert(schema.paymentStreams).values({ trancheId });
    const valid = row('valid', 'valid_key');
    await db.insert(schema.paymentOperations).values(valid);
    for (const change of [
      { providerRequestId: valid.providerRequestId },
      { operation: {} },
      { operation: { ...row('invalid', 'bad').operation, effect: 'CAPTURE', target: 'EXPIRED' } },
      { status: 'CONFIRMED', reference: null },
      { status: 'FAILED', reference: ' ' },
      { version: 0 },
    ])
      await expect(
        db.insert(schema.paymentOperations).values({ ...row('invalid', 'bad'), ...change } as typeof valid),
      ).rejects.toThrow();
  });
  it('protects identity, resolved outcomes and append-only history against direct SQL changes', async () => {
    await db.insert(schema.paymentStreams).values({ trancheId: 'history' });
    await db.insert(schema.paymentOperations).values(row('history', 'history_key'));
    await db
      .insert(schema.paymentOperationEvents)
      .values({ trancheId: 'history', key: 'history_key', version: 1, status: 'RESERVED' });
    await expect(
      pool.query('UPDATE payment_operations SET provider_request_id = $1 WHERE key = $2', [
        randomUUID(),
        'history_key',
      ]),
    ).rejects.toThrow('Operation identity is immutable');
    await db
      .update(schema.paymentOperations)
      .set({ status: 'CONFIRMED', reference: 'capture_completed', version: 2 })
      .where(eq(schema.paymentOperations.key, 'history_key'));
    await expect(
      pool.query('UPDATE payment_operations SET status = $1 WHERE key = $2', ['AMBIGUOUS', 'history_key']),
    ).rejects.toThrow('Operation already resolved');
    for (const statement of [
      'UPDATE payment_operation_events SET reference = NULL',
      'DELETE FROM payment_operation_events',
      'TRUNCATE payment_operation_events',
    ])
      await expect(pool.query(statement)).rejects.toThrow('Payment history is append-only');
    expect(await db.select().from(schema.paymentOperationEvents)).toHaveLength(1);
  });
  it('keeps the declared foreign keys and migrated constraints consistent', async () => {
    for (const table of [schema.paymentOperations, schema.paymentOperationEvents, schema.trancheCommands])
      for (const foreignKey of getTableConfig(table).foreignKeys)
        expect(foreignKey.reference().foreignColumns).toHaveLength(foreignKey.reference().columns.length);
    await expect(
      db.insert(schema.paymentOperations).values(row('missing_stream', 'missing_key')),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(
      db
        .insert(schema.paymentOperationEvents)
        .values({ trancheId: 'valid', key: 'missing_operation', version: 9, status: 'RESERVED' }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
    await expect(
      db
        .insert(schema.paymentOperationEvents)
        .values({ trancheId: 'invalid', key: 'valid_key', version: 10, status: 'RESERVED' }),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
  it('rejects backward transitions and non-increasing versions while allowing unresolved progress', async () => {
    await db.insert(schema.paymentStreams).values({ trancheId: 'transitions' });
    await db.insert(schema.paymentOperations).values(row('transitions', 'transitions_key'));
    for (const version of [0, 1])
      await expect(
        pool.query("UPDATE payment_operations SET status = 'AMBIGUOUS', version = $1 WHERE key = 'transitions_key'", [
          version,
        ]),
      ).rejects.toThrow('Operation version must increase');
    await pool.query("UPDATE payment_operations SET status = 'AMBIGUOUS', version = 2 WHERE key = 'transitions_key'");
    await expect(
      pool.query("UPDATE payment_operations SET status = 'RESERVED', version = 3 WHERE key = 'transitions_key'"),
    ).rejects.toThrow('Invalid operation transition');
    await pool.query("UPDATE payment_operations SET status = 'AMBIGUOUS', version = 3 WHERE key = 'transitions_key'");
    await pool.query(
      "UPDATE payment_operations SET status = 'FAILED', reference = 'declined', version = 4 WHERE key = 'transitions_key'",
    );
    await expect(
      pool.query("UPDATE payment_operations SET status = 'RESERVED', version = 5 WHERE key = 'transitions_key'"),
    ).rejects.toThrow('Operation already resolved');
  });
  it('accepts only valid event statuses and nonblank resolved references', async () => {
    await db.insert(schema.paymentStreams).values({ trancheId: 'event_checks' });
    await db.insert(schema.paymentOperations).values(row('event_checks', 'event_checks_key'));
    await db
      .insert(schema.paymentOperationEvents)
      .values({ trancheId: 'event_checks', key: 'event_checks_key', version: 1, status: 'RESERVED' });
    for (const [status, reference] of [
      ['UNKNOWN', null],
      ['CONFIRMED', null],
      ['FAILED', ' '],
    ])
      await expect(
        pool.query(
          'INSERT INTO payment_operation_events (tranche_id, key, version, status, reference) VALUES ($1, $2, 2, $3, $4)',
          ['event_checks', 'event_checks_key', status, reference],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    for (const [index, status] of ['RESERVED', 'AMBIGUOUS', 'CONFIRMED', 'FAILED'].entries())
      await pool.query(
        'INSERT INTO payment_operation_events (tranche_id, key, version, status, reference) VALUES ($1, $2, $3, $4, $5)',
        ['event_checks', 'event_checks_key', index + 2, status, index > 1 ? 'provider_reference' : null],
      );
    await expect(
      pool.query(
        "INSERT INTO payment_operation_events (tranche_id, key, version, status) VALUES ('event_checks', 'event_checks_key', 0, 'RESERVED')",
      ),
    ).rejects.toMatchObject({ constraint: 'event_version_valid' });
  });
  it('enforces the complete operation transition matrix', async () => {
    const statuses = ['RESERVED', 'AMBIGUOUS', 'CONFIRMED', 'FAILED'] as const;
    for (const from of statuses)
      for (const to of statuses) {
        const key = `matrix_${from}_${to}`;
        await db.insert(schema.paymentStreams).values({ trancheId: key });
        await db.insert(schema.paymentOperations).values(row(key, key));
        if (from !== 'RESERVED')
          await pool.query('UPDATE payment_operations SET status = $1, reference = $2, version = 2 WHERE key = $3', [
            from,
            'provider_reference',
            key,
          ]);
        const update = pool.query(
          'UPDATE payment_operations SET status = $1, reference = $2, version = 3 WHERE key = $3',
          [to, 'provider_reference', key],
        );
        if (from === 'CONFIRMED' || from === 'FAILED')
          await expect(update).rejects.toThrow('Operation already resolved');
        else if (to === 'RESERVED') await expect(update).rejects.toThrow('Invalid operation transition');
        else await expect(update).resolves.toMatchObject({ rowCount: 1 });
      }
  });
  it('sets timestamps with the database clock despite supplied values and keeps them immutable', async () => {
    await db.insert(schema.paymentStreams).values({ trancheId: 'timestamps' });
    const before = await pool.query('SELECT clock_timestamp() AS time');
    await db.insert(schema.paymentOperations).values(row('timestamps', 'timestamps_key'));
    const operation = await pool.query("SELECT created_at FROM payment_operations WHERE key = 'timestamps_key'");
    const event = await pool.query(
      "INSERT INTO payment_operation_events (tranche_id, key, version, status, recorded_at) VALUES ('timestamps', 'timestamps_key', 1, 'RESERVED', '2100-01-01') RETURNING recorded_at",
    );
    const after = await pool.query('SELECT clock_timestamp() AS time');
    for (const timestamp of [operation.rows[0].created_at, event.rows[0].recorded_at]) {
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(before.rows[0].time.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(after.rows[0].time.getTime());
    }
    await expect(
      pool.query(
        "UPDATE payment_operations SET created_at = '2100-01-01', status = 'AMBIGUOUS', version = 2 WHERE key = 'timestamps_key'",
      ),
    ).rejects.toThrow('Operation timestamp is immutable');
    await expect(
      pool.query("UPDATE payment_operation_events SET recorded_at = '2100-01-01' WHERE key = 'timestamps_key'"),
    ).rejects.toThrow('Payment history is append-only');
    await pool.query(
      "UPDATE payment_operations SET status = 'FAILED', reference = 'declined', version = 2 WHERE key = 'timestamps_key'",
    );
    const unchanged = await pool.query("SELECT created_at FROM payment_operations WHERE key = 'timestamps_key'");
    expect(unchanged.rows[0].created_at).toEqual(operation.rows[0].created_at);
    const supplied = await pool.query(
      "INSERT INTO payment_operations (key, tranche_id, operation, provider_request_id, status, reserved_from_version, version, created_at) VALUES ($1, $2, $3, $4, 'RESERVED', 2, 3, '2100-01-01') RETURNING created_at",
      ['timestamp_override', 'timestamps', row('timestamps', 'timestamp_override').operation, randomUUID()],
    );
    expect(supplied.rows[0].created_at.getUTCFullYear()).toBe(before.rows[0].time.getUTCFullYear());
  });
  const invalidStarts = [
    { status: 'AMBIGUOUS' },
    { status: 'CONFIRMED', reference: 'capture' },
    { status: 'FAILED', reference: 'decline' },
    { reference: '' },
    { reference: 'provided' },
  ] as const;
  it.each(invalidStarts)('rejects an invalid operation start: %j', async (change) => {
    const key = randomUUID();
    await db.insert(schema.paymentStreams).values({ trancheId: key });
    await expect(db.insert(schema.paymentOperations).values({ ...row(key, key), ...change })).rejects.toMatchObject({
      cause: { message: 'New operation must be reserved without reference' },
    });
  });
  it.each(invalidStarts)('rejects an invalid first event: %j', async (change) => {
    const key = randomUUID();
    await db.insert(schema.paymentStreams).values({ trancheId: key });
    await db.insert(schema.paymentOperations).values(row(key, key));
    await expect(
      db
        .insert(schema.paymentOperationEvents)
        .values({ trancheId: key, key, version: 1, status: 'RESERVED', ...change }),
    ).rejects.toMatchObject({ cause: { message: 'First event must be reserved without reference' } });
    await db.insert(schema.paymentOperationEvents).values({ trancheId: key, key, version: 1, status: 'RESERVED' });
  });
});
