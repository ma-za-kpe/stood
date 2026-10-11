import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PostgresRateLimits } from './rate-limits.js';
import * as schema from './schema.js';

const name = `test_rate_${randomUUID().replaceAll('-', '')}`;
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

// T-0156: one budget across instances: concurrent hits are all counted, and each scope keeps only its current window.
it('counts concurrent hits exactly and keeps one window per scope', async () => {
  const limits = new PostgresRateLimits(db);
  const minute = Date.parse('2026-10-11T20:00:00Z');
  const counts = await Promise.all(Array.from({ length: 25 }, () => limits.hit('platform:a:write', 1, minute)));
  expect(counts.sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
  expect(await limits.hit('platform:a:write', 0, minute)).toBe(25);
  expect(await limits.hit('platform:a:read', 0, minute)).toBe(0);
  expect(await limits.hit('platform:a:write', 1, minute + 60_000)).toBe(1);
  const rows = (await pool.query("SELECT count(*)::int AS n FROM rate_windows WHERE scope = 'platform:a:write'"))
    .rows[0].n;
  expect(rows).toBe(1);
  await expect(limits.hit('', 1, minute)).rejects.toThrow('INVALID_RATE_HIT');
});
