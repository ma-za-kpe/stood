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
      .set({ status: 'AMBIGUOUS' })
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
      .set({ status: 'CONFIRMED', reference: 'capture_completed' })
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
    for (const table of [schema.paymentOperations, schema.paymentOperationEvents])
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
});
