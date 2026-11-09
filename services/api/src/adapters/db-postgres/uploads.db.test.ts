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
const adminUrl = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://stood:stood_local_only@db:5432/stood');
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${name}`;
const admin = new pg.Pool({ connectionString: adminUrl.toString() });
const pool = new pg.Pool({ connectionString: databaseUrl.toString() });
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
  const first = draft.tranches.at(0);
  if (!first) throw new Error('Expected a tranche');
  return first.id;
}
it('reserves one durable session for racing exact retries; changed body and tenant conflicts never return its object keys', async () => {
  const id = await tranche(),
    now = Date.now();
  const results = await Promise.all(
    Array.from({ length: 8 }, () => store.reserve('platform', id, 'one', 'c'.repeat(64), photos, now)),
  );
  expect(new Set(results.map((s) => s.id)).size).toBe(1);
  const first = results.at(0);
  if (!first) throw new Error('Expected a reserved upload');
  expect(first.photos[0]?.key).toMatch(/^uploads\/upl_[a-f0-9-]+\/0-[a-f0-9]{64}$/);
  expect(await store.get('other', id, first.id)).toBeNull();
  await expect(store.reserve('other', id, 'one', 'c'.repeat(64), photos, now)).rejects.toThrow('NOT_FOUND');
  await expect(store.reserve('platform', id, 'one', 'd'.repeat(64), photos, now)).rejects.toThrow('CONFLICT');
  expect(await new PostgresUploads(drizzle(pool, { schema })).get('platform', id, first.id)).toEqual(first);
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
it('durably binds the immutable assessment receipt to one idempotency key and request body', async () => {
  const id = await tranche(),
    now = Date.now();
  const open = await store.reserve('platform', id, 'assessment-upload', 'c'.repeat(64), photos, now);
  await store.complete('platform', id, open.id, now + 1);
  const receipt = { payload: { evidenceId: 'evidence-1' }, signature: 'signed' };
  const requestHash = 'd'.repeat(64),
    receiptHash = 'e'.repeat(64);
  await store.recordAssessment('platform', id, open.id, 'assessment-key', requestHash, receipt, receiptHash, now + 2);
  expect(await store.loadAssessment('platform', id, open.id, 'assessment-key', requestHash)).toEqual(receipt);
  await expect(store.loadAssessment('platform', id, open.id, 'assessment-key', 'f'.repeat(64))).rejects.toThrow(
    'CONFLICT',
  );
  await expect(store.loadAssessment('platform', id, open.id, 'another-key', requestHash)).rejects.toThrow('CONFLICT');
  await expect(
    store.recordAssessment(
      'platform',
      id,
      open.id,
      'assessment-key',
      requestHash,
      { payload: { evidenceId: 'changed' }, signature: 'changed' },
      'f'.repeat(64),
      now + 3,
    ),
  ).rejects.toThrow('CONFLICT');
  await expect(store.loadAssessment('other', id, open.id, 'assessment-key', requestHash)).rejects.toThrow('NOT_FOUND');
});
it('refuses malformed, unknown, open or early assessment requests and replays an exact retry', async () => {
  const id = await tranche(),
    now = Date.now();
  const receipt = { payload: { evidenceId: 'evidence-2' }, signature: 'signed' };
  const [request, hash] = ['d'.repeat(64), 'e'.repeat(64)];
  const open = await store.reserve('platform', id, 'assessment-edges', 'c'.repeat(64), photos, now);
  // Nothing recorded yet: a read finds no receipt rather than inventing one.
  expect(await store.loadAssessment('platform', id, open.id, 'k', request)).toBeNull();
  for (const [key, req, rh] of [
    [' ', request, hash],
    ['k'.repeat(201), request, hash],
    ['k', 'not-a-hash', hash],
    ['k', request, 'not-a-hash'],
  ] as const)
    await expect(store.recordAssessment('platform', id, open.id, key, req, receipt, rh, now)).rejects.toThrow(
      'INVALID',
    );
  await expect(store.loadAssessment('platform', id, open.id, ' ', request)).rejects.toThrow('INVALID');
  await expect(store.recordAssessment('platform', id, 'missing', 'k', request, receipt, hash, now)).rejects.toThrow(
    'NOT_FOUND',
  );
  // Only a completed upload can carry an assessment.
  await expect(store.recordAssessment('platform', id, open.id, 'k', request, receipt, hash, now)).rejects.toThrow(
    'CONFLICT',
  );
  await expect(store.complete('platform', id, 'missing', now)).rejects.toThrow('NOT_FOUND');
  await expect(store.complete('platform', id, open.id, open.createdAt - 1)).rejects.toThrow('INVALID');
  await store.complete('platform', id, open.id, now + 1);
  const first = await store.recordAssessment('platform', id, open.id, 'k', request, receipt, hash, now + 2);
  expect(await store.recordAssessment('platform', id, open.id, 'k', request, receipt, hash, now + 3)).toEqual(first);
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

it('cleans only expired OPEN upload objects, resumes per-object receipts, and excludes completed photos', async () => {
  const id = await tranche();
  const base = Date.now() - 2 * 24 * 60 * 60_000;
  const completeOpen = await store.reserve('platform', id, 'complete-first', 'c'.repeat(64), photos, base);
  const completePhoto = completeOpen.photos[0];
  if (!completePhoto) throw new Error('Expected a declared photo');
  await store.complete('platform', id, completeOpen.id, base + 1);
  const firstPhoto = photos[0];
  if (!firstPhoto) throw new Error('Expected a declared photo');
  const abandoned = await store.reserve(
    'platform',
    id,
    'abandoned',
    'd'.repeat(64),
    [firstPhoto, { sha256: 'e'.repeat(64), bytes: 5, contentType: 'image/jpeg' as const }],
    base + 2,
  );
  const [abandonedFirst, abandonedSecond] = abandoned.photos;
  if (!abandonedFirst || !abandonedSecond) throw new Error('Expected two declared photos');
  const now = abandoned.expiresAt + 60 * 60_000;
  expect(await store.expiredOpen(now, 60 * 60_000, 25)).toEqual([{ id: abandoned.id, photos: abandoned.photos }]);
  expect(await store.recordCleanup(abandoned.id, abandonedFirst.key, 'DELETED', now, 60 * 60_000)).toBe(true);
  expect(await store.recordCleanup(abandoned.id, abandonedFirst.key, 'DELETED', now, 60 * 60_000)).toBe(false);
  expect(await store.expiredOpen(now, 60 * 60_000, 25)).toEqual([{ id: abandoned.id, photos: [abandonedSecond] }]);
  expect(await store.recordCleanup(completeOpen.id, completePhoto.key, 'DELETED', now, 60 * 60_000)).toBe(false);
  await expect(
    pool.query('UPDATE upload_cleanup_receipts SET outcome = $1 WHERE session_id = $2', ['ABSENT', abandoned.id]),
  ).rejects.toThrow('immutable');
  await expect(pool.query('DELETE FROM upload_cleanup_receipts WHERE session_id = $1', [abandoned.id])).rejects.toThrow(
    'immutable',
  );
});

it('backs off failed objects so a batch of failures cannot starve the next expired sessions', async () => {
  const base = Date.now() - 2 * 24 * 60 * 60_000;
  const entries = await Promise.all(
    Array.from({ length: 26 }, async (_, index) => {
      const platform = `cleanup-fair-${index}`;
      const id = await tranche(platform);
      const session = await store.reserve(platform, id, 'expired', 'f'.repeat(64), photos, base);
      return session;
    }),
  );
  const now = Math.max(...entries.map((entry) => entry.expiresAt)) + 60 * 60_000;
  const firstBatch = await store.expiredOpen(now, 60 * 60_000, 25);
  expect(firstBatch).toHaveLength(25);
  await Promise.all(
    firstBatch.map((session) => {
      const photo = session.photos.at(0);
      if (!photo) throw new Error('Expected an upload object');
      return store.recordCleanupFailure(session.id, photo.key, now, 60 * 60_000);
    }),
  );

  const nextBatch = await store.expiredOpen(now, 60 * 60_000, 25);
  const retriedIds = new Set(firstBatch.map((session) => session.id));
  const notYetAttempted = entries.filter((entry) => !retriedIds.has(entry.id));
  expect(notYetAttempted.length).toBeGreaterThan(0);
  expect(nextBatch.map((session) => session.id)).toEqual(
    expect.arrayContaining(notYetAttempted.map((entry) => entry.id)),
  );
  expect(nextBatch.some((session) => retriedIds.has(session.id))).toBe(false);
});
