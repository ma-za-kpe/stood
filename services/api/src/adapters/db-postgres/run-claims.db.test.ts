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
  const winners = racers.filter((r) => r !== null);
  expect(winners.map((w) => w?.attempts)).toEqual([1]);
  const lease = winners[0] as { attempts: number; token: string };
  expect((await store.states('baseline', ['bl_a', 'bl_new'])).get('bl_a')).toEqual({ attempts: 1, due: false });
  await store.release('baseline', 'bl_a', lease.token, 'WAIT:GITHUB_UNAVAILABLE');
  expect(await store.claim('baseline', 'bl_a', 60_000)).toBeNull();
  const [row] = (
    await pool.query(
      "SELECT last_reason, next_attempt_at - clock_timestamp() > interval '50 seconds' AS later FROM run_claims WHERE job_id = 'bl_a'",
    )
  ).rows;
  expect(row).toEqual({ last_reason: 'WAIT:GITHUB_UNAVAILABLE', later: true });
  // The same id under another kind is another job.
  const other = await store.claim('package', 'bl_a', 60_000);
  expect(other?.attempts).toBe(1);
  await store.release('package', 'bl_a', other?.token ?? '', null);
  expect((await store.states('package', ['bl_a'])).size).toBe(0);
});

// Second audit (2026-10-11): a runner whose lease ran out must not release or renew the next owner's lease.
it('fences an expired owner: only the current token renews or releases', async () => {
  const store = new PostgresRunClaims(drizzle(pool, { schema }));
  const a = await store.claim('baseline', 'bl_dead', 1);
  await new Promise((r) => setTimeout(r, 20));
  const b = await store.claim('baseline', 'bl_dead', 60_000);
  expect([a?.attempts, b?.attempts]).toEqual([1, 2]);
  expect(await store.renew('baseline', 'bl_dead', a?.token ?? '', 60_000)).toBe(false);
  await store.release('baseline', 'bl_dead', a?.token ?? '', null);
  expect((await store.states('baseline', ['bl_dead'])).get('bl_dead')).toEqual({ attempts: 2, due: false });
  expect(await store.renew('baseline', 'bl_dead', b?.token ?? '', 60_000)).toBe(true);
  await store.release('baseline', 'bl_dead', b?.token ?? '', null);
  expect((await store.states('baseline', ['bl_dead'])).size).toBe(0);
});
