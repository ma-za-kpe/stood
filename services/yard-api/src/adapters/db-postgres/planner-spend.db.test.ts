import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PostgresPlannerSpend } from './planner-spend.js';
import { migrateYard, setupYardRoles } from './setup.js';

const suffix = randomUUID().replaceAll('-', '');
const name = `test_spend_${suffix}`;
const roles = { owner: `yard_owner_${suffix}`, runtime: `yard_runtime_${suffix}` };
const password = randomUUID().replaceAll('-', '');
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const pool = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
const url = new URL(`postgres://db:5432/${name}`);
url.username = roles.runtime;
url.password = password;
const runtime = new pg.Pool({ connectionString: url.toString(), max: 10 });
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await setupYardRoles(pool, { ...roles, password });
  await migrateYard(pool, roles);
});
afterAll(async () => {
  await runtime.end();
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.query(`DROP ROLE ${roles.runtime}`);
  await admin.query(`DROP ROLE ${roles.owner}`);
  await admin.end();
});

// T-0181: the daily planner budget survives restarts and holds under concurrent plans: reservations are atomic.
it('reserves atomically against a daily budget, settles real costs and starts again each UTC day', async () => {
  let now = Date.parse('2026-10-09T12:00:00Z');
  const guard = new PostgresPlannerSpend(runtime, 10_000, () => now);
  const results = await Promise.all(Array.from({ length: 8 }, () => guard.reserve(3_000)));
  expect(results.filter(Boolean)).toHaveLength(3);
  expect(await guard.spent()).toBe(9_000);
  await guard.settle(3_000, 1_000);
  expect(await guard.spent()).toBe(7_000);
  expect(await guard.reserve(2_999)).toBe(true);
  expect(await guard.reserve(1)).toBe(true);
  expect(await guard.reserve(1)).toBe(false);
  // A restart keeps the day's spend.
  expect(await new PostgresPlannerSpend(runtime, 10_000, () => now).spent()).toBe(10_000);
  now += 86_400_000;
  expect(await guard.reserve(10_000)).toBe(true);
  await expect(runtime.query('DROP TABLE yard.planner_spend')).rejects.toThrow(/must be owner|permission denied/);
});
