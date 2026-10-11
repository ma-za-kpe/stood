import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { codeParams as params } from '../../../test/fixtures/code-terms.js';
import { codeTerms } from '../../application/code-terms.js';
import { PostgresBaselines } from './baselines.js';
import { PostgresRunClaims } from './run-claims.js';
import * as schema from './schema.js';

const name = `test_baselines_${randomUUID().replaceAll('-', '')}`;
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
const codeParams = codeTerms(params);
const fp = (c: string) => c.repeat(64);
const result = {
  tests: [{ id: codeParams.testIds[0] as string, status: 'FAIL' as const }],
  evidence: { key: `baselines/p/x/${'e'.repeat(64)}`, sha256: 'e'.repeat(64) },
};

// C4 (#77): baselines are idempotent per platform and key, owned by their platform, queued until the runner finishes
// them once.
it('requests a baseline once per key, refuses a changed request, and keeps platforms apart', async () => {
  const store = new PostgresBaselines(db);
  const first = await store.request('platform_a', 'base-1', fp('a'), codeParams);
  expect(first).toMatchObject({
    status: 'QUEUED',
    result: null,
    finishedAt: null,
    terms: { baseCommit: codeParams.baseCommit },
  });
  expect(await store.request('platform_a', 'base-1', fp('a'), codeParams)).toEqual(first);
  await expect(store.request('platform_a', 'base-1', fp('b'), codeParams)).rejects.toThrow('CONFLICT');
  await expect(
    store.request('platform_a', 'base-1', fp('a'), { ...codeParams, baseCommit: 'f'.repeat(40) }),
  ).rejects.toThrow('CONFLICT');
  await expect(store.request('platform_a', 'base-2', fp('a'), { ...codeParams, testIds: [] })).rejects.toThrow(
    'INVALID',
  );
  await expect(store.request('platform_a', ' ', fp('a'), codeParams)).rejects.toThrow('INVALID');
  expect(await store.get('platform_b', first.id)).toBeNull();
  const other = await store.request('platform_b', 'base-1', fp('a'), codeParams);
  expect(other.id).not.toBe(first.id);
});

it('lists queued baselines oldest first and records each result exactly once', async () => {
  const store = new PostgresBaselines(db);
  const a = await store.request('platform_c', 'q-1', fp('c'), codeParams);
  const b = await store.request('platform_c', 'q-2', fp('c'), codeParams);
  const queued = (await store.pending(50)).map((j) => j.id);
  expect(queued.indexOf(a.id)).toBeLessThan(queued.indexOf(b.id));
  expect((await store.pending(50)).find((j) => j.id === a.id)).toMatchObject({
    platformId: 'platform_c',
    terms: { repository: codeParams.repository },
  });
  await store.finish(a.id, { status: 'DONE', result });
  await store.finish(a.id, { status: 'INVALID' });
  expect(await store.get('platform_c', a.id)).toMatchObject({ status: 'DONE', result, finishedAt: expect.any(String) });
  await store.finish(b.id, { status: 'INVALID' });
  expect(await store.get('platform_c', b.id)).toMatchObject({ status: 'INVALID', result: null });
  expect((await store.pending(50)).map((j) => j.id)).not.toContain(a.id);
});

// Second audit (2026-10-11): fifty baselines backing off must not hide the fifty-first.
it('lists only due baselines, fewest attempts first, past any number that are backing off', async () => {
  const store = new PostgresBaselines(db);
  const claims = new PostgresRunClaims(db);
  for (const { id } of (await pool.query("SELECT id FROM baselines WHERE status = 'QUEUED'")).rows)
    await store.finish(id, { status: 'INVALID' });
  const queued = [];
  for (let i = 0; i < 51; i++) queued.push(await store.request('platform_f', `f-${i}`, fp('f'), codeParams));
  for (const b of queued.slice(0, 50)) {
    const lease = await claims.claim('baseline', b.id, 60_000);
    await claims.release('baseline', b.id, lease?.token ?? '', 'WAIT:RUNNER_UNAVAILABLE:CREATE');
  }
  expect((await store.pending(50)).map((j) => j.id)).toEqual([queued[50]?.id]);
  // Once due again, those that waited come after any never tried.
  await pool.query("UPDATE run_claims SET next_attempt_at = clock_timestamp() - interval '1 second'");
  const order = (await store.pending(50)).map((j) => j.id);
  expect(order[0]).toBe(queued[50]?.id);
  expect(order).toHaveLength(50);
});
