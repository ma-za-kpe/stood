import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PostgresReconciliationFindings } from './reconciliation-findings.js';
import * as schema from './schema.js';

const name = `test_findings_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const pool = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
const db = drizzle(pool, { schema });
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
const rows = async () =>
  (
    await pool.query(
      'SELECT kind, provider_id, operation_key, owner, status FROM reconciliation_findings ORDER BY kind',
    )
  ).rows;

it('keeps one owned row per finding, and resolves it only when a later audit re-checked it and found it fixed (T-0155)', async () => {
  const store = new PostgresReconciliationFindings(db);
  const stray = { kind: 'CAPTURE_WITHOUT_RELEASE' as const, trancheId: null, providerId: 'CAP-9', operationKey: null };
  const missing = { kind: 'RELEASE_WITHOUT_CAPTURE' as const, trancheId: 't1', providerId: null, operationKey: 'op1' };
  await store.record([stray, missing], 'reviewer');
  await store.record([stray, missing], 'reviewer');
  expect(await rows()).toEqual([
    { kind: 'CAPTURE_WITHOUT_RELEASE', provider_id: 'CAP-9', operation_key: null, owner: 'reviewer', status: 'OPEN' },
    { kind: 'RELEASE_WITHOUT_CAPTURE', provider_id: null, operation_key: 'op1', owner: 'reviewer', status: 'OPEN' },
  ]);
  // The next audit re-checked op1 and it is fine now; CAP-9 fell outside the window and stays open for a person.
  expect(await store.resolveFixed([stray], { operationKeys: ['op1'], providerIds: [] })).toBe(1);
  expect((await rows()).map((r) => [r.operation_key ?? r.provider_id, r.status])).toEqual([
    ['CAP-9', 'OPEN'],
    ['op1', 'RESOLVED'],
  ]);
  // If it comes back, the same row reopens.
  await store.record([missing], 'reviewer');
  expect((await rows()).find((r) => r.operation_key === 'op1')?.status).toBe('OPEN');
  await expect(store.record([missing], ' ')).rejects.toThrow();
});

it('resolves nothing when nothing was re-checked, and everything re-checked when no findings remain', async () => {
  await pool.query('DELETE FROM reconciliation_findings');
  const store = new PostgresReconciliationFindings(db);
  const stray = { kind: 'CAPTURE_WITHOUT_RELEASE' as const, trancheId: null, providerId: 'CAP-7', operationKey: null };
  const dup = { kind: 'DUPLICATE_CAPTURE' as const, trancheId: 't3', providerId: 'CAP-8', operationKey: 'op3' };
  await store.record([stray, dup], 'reviewer');
  expect(await store.resolveFixed([], { operationKeys: [], providerIds: [] })).toBe(0);
  // Re-checked by provider id only, and nothing is wrong any more: both resolve.
  expect(await store.resolveFixed([], { operationKeys: [], providerIds: ['CAP-7', 'CAP-8'] })).toBe(2);
  expect((await rows()).every((r) => r.status === 'RESOLVED')).toBe(true);
});
