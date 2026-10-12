import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PostgresPlatformApi } from './platform-api.js';
import * as schema from './schema.js';
import { PostgresUploads } from './uploads.js';

const name = `test_uploads_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const pool = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
const db = drizzle(pool, { schema }),
  store = new PostgresUploads(db);
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
const photos = [{ sha256: 'a'.repeat(64), bytes: 4, contentType: 'image/jpeg' as const }];
async function tranche(platform = 'platform') {
  const draft = await new PostgresPlatformApi(db).create(platform, randomUUID(), 'b'.repeat(64), {
    payee_ref: 'sandbox-payee',
    cap: { minor: 100, currency: 'USD' },
    milestones: [
      { name: 'Site visit', amount: { minor: 100, currency: 'USD' }, profile: 'construction.stage@1', params: {} },
    ],
    window_days: 7,
    max_resubmits: 1,
  });
  return draft.tranches[0]!.id;
}
it('reserves one durable session for racing exact retries; changed body and tenant conflicts never return its object keys', async () => {
  const id = await tranche(),
    now = Date.now();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => store.reserve('platform', id, 'one', 'c'.repeat(64), photos, now)),
  );
  expect(new Set(results.map((s) => s.id)).size).toBe(1);
  expect(results[0]?.photos[0]?.key).toMatch(/^uploads\/upl_[a-f0-9-]+\/0-[a-f0-9]{64}$/);
  expect(await store.get('other', id, results[0]!.id)).toBeNull();
  await expect(store.reserve('other', id, 'one', 'c'.repeat(64), photos, now)).rejects.toThrow('NOT_FOUND');
  await expect(store.reserve('platform', id, 'one', 'd'.repeat(64), photos, now)).rejects.toThrow('CONFLICT');
  expect(await new PostgresUploads(drizzle(pool, { schema })).get('platform', id, results[0]!.id)).toEqual(results[0]);
});
it('records completion once, refuses expiry and keeps the original receipt when retried after expiry', async () => {
  const id = await tranche(),
    now = Date.now();
  const open = await store.reserve('platform', id, 'one', 'c'.repeat(64), photos, now);
  await expect(store.complete('other', id, open.id, now)).rejects.toThrow('NOT_FOUND');
  await expect(store.complete('platform', id, open.id, open.expiresAt)).rejects.toThrow('EXPIRED');
  const complete = await store.complete('platform', id, open.id, now + 1);
  expect(complete.status).toBe('COMPLETE');
  expect(await store.complete('platform', id, open.id, open.expiresAt + 1)).toEqual(complete);
  expect(await store.reserve('platform', id, 'one', 'c'.repeat(64), photos, now + 2)).toEqual(complete);
});
it('permits only one open session per tranche and bounds reservations, refusing malformed time or metadata', async () => {
  const id = await tranche(),
    now = Date.now();
  await store.reserve('platform', id, 'one', 'c'.repeat(64), photos, now);
  await expect(store.reserve('platform', id, 'two', 'c'.repeat(64), photos, now)).rejects.toThrow('CONFLICT');
  await expect(store.reserve('platform', id, 'two', 'c'.repeat(64), photos, Number.NaN)).rejects.toThrow('INVALID');
  await expect(store.reserve('platform', id, 'two', 'invalid', photos, now)).rejects.toThrow('INVALID');
  await expect(store.reserve('platform', id, 'two', 'c'.repeat(64), [], now)).rejects.toThrow('INVALID');
});

it('protects object identities and completed receipts against direct database rewriting', async () => {
  const id = await tranche(),
    now = Date.now();
  const open = await store.reserve('platform', id, 'one', 'c'.repeat(64), photos, now);
  await expect(
    pool.query('UPDATE upload_sessions SET photos = $1 WHERE id = $2', [
      JSON.stringify([{ ...photos[0], key: 'another/object' }]),
      open.id,
    ]),
  ).rejects.toThrow('immutable');
  await store.complete('platform', id, open.id, now + 1);
  await expect(
    pool.query('UPDATE upload_sessions SET completed_at = $1 WHERE id = $2', [now + 2, open.id]),
  ).rejects.toThrow('immutable');
  await expect(pool.query('DELETE FROM upload_sessions WHERE id = $1', [open.id])).rejects.toThrow('immutable');
});
