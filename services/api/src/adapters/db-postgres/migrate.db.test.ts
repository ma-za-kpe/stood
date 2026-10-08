import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyMigrations } from './migrate.js';

const name = `test_migrate_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const url = `postgres://stood:stood_local_only@db:5432/${name}`;
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
});
afterAll(async () => {
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});

it('applies every migration to an empty database, and a second run changes nothing (T-0253)', async () => {
  const folder = resolve('services/api/drizzle');
  const first = await applyMigrations(url, folder);
  expect(first.applied).toBeGreaterThanOrEqual(19);
  const second = await applyMigrations(url, folder);
  expect(second.applied).toBe(0);
  const pool = new pg.Pool({ connectionString: url });
  try {
    const tables = await pool.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(tables.rows[0].n).toBeGreaterThanOrEqual(16);
  } finally {
    await pool.end();
  }
});
