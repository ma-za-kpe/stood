import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PostgresRunClaims } from './run-claims.js';
import * as schema from './schema.js';

const name = `test_run_claims_${randomUUID().replaceAll('-', '')}`;
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

// Audit 2026-10-10, finding 4: of runners racing for one job exactly one gets it; a waited job backs off; a finished
// job is forgotten; a lease that expires (a runner that died) lets another runner take the job.
it('grants one lease per job among racing runners, backs off a waiting job and forgets a finished one', async () => {
  const store = new PostgresRunClaims(drizzle(pool, { schema }));
  const racers = await Promise.all(Array.from({ length: 8 }, () => store.claim('baseline', 'bl_a', 60_000)));
  expect(racers.filter((r) => r !== null)).toEqual([1]);
  expect((await store.states('baseline', ['bl_a', 'bl_new'])).get('bl_a')).toEqual({ attempts: 1, due: false });
  await store.release('baseline', 'bl_a', 'WAIT:GITHUB_UNAVAILABLE');
  expect(await store.claim('baseline', 'bl_a', 60_000)).toBeNull();
  const [row] = (
    await pool.query(
      "SELECT last_reason, next_attempt_at - clock_timestamp() > interval '50 seconds' AS later FROM run_claims WHERE job_id = 'bl_a'",
    )
  ).rows;
  expect(row).toEqual({ last_reason: 'WAIT:GITHUB_UNAVAILABLE', later: true });
  // The same id under another kind is another job.
  expect(await store.claim('package', 'bl_a', 60_000)).toBe(1);
  await store.release('package', 'bl_a', null);
  expect((await store.states('package', ['bl_a'])).size).toBe(0);
  // A runner that died mid-run: its lease runs out and the job is taken again, counting the attempt.
  expect(await store.claim('baseline', 'bl_dead', 1)).toBe(1);
  await new Promise((r) => setTimeout(r, 20));
  expect(await store.claim('baseline', 'bl_dead', 60_000)).toBe(2);
});
