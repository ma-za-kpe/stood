import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { migrateYard, setupYardRoles } from './setup.js';

const suffix = randomUUID().replaceAll('-', '');
const name = `test_yard_setup_${suffix}`;
const roles = { owner: `yard_owner_${suffix}`, runtime: `yard_runtime_${suffix}` };
const password = randomBytes(24).toString('hex');
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const pool = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
const runtimeUrl = new URL(`postgres://db:5432/${name}`);
runtimeUrl.username = roles.runtime;
runtimeUrl.password = password;
const limited = new pg.Pool({ connectionString: runtimeUrl.toString() });
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await pool.query('CREATE TABLE public.stood_money (id int)');
});
afterAll(async () => {
  await limited.end();
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.query(`DROP ROLE ${roles.runtime}`);
  await admin.query(`DROP ROLE ${roles.owner}`);
  await admin.end();
});

// T-0214: hosted Yard gets its own restricted database role on Stood's database. Roles are made once by the
// operator; every release then applies Yard's schema. Both steps are safe to repeat.
it('creates separate Yard roles once, applies the schema on every release, and keeps Yard out of Stood tables', async () => {
  for (const _ of [1, 2]) {
    await setupYardRoles(pool, { ...roles, password });
    await migrateYard(pool, roles);
  }
  const { rows } = await admin.query(
    'SELECT rolname, rolcanlogin, rolsuper, rolcreaterole FROM pg_roles WHERE rolname IN ($1, $2) ORDER BY rolcanlogin',
    [roles.owner, roles.runtime],
  );
  expect(rows).toEqual([
    { rolname: roles.owner, rolcanlogin: false, rolsuper: false, rolcreaterole: false },
    { rolname: roles.runtime, rolcanlogin: true, rolsuper: false, rolcreaterole: false },
  ]);
  expect((await limited.query('SELECT count(*)::int AS n FROM yard.projects')).rows[0].n).toBe(0);
  await expect(limited.query('SELECT * FROM public.stood_money')).rejects.toThrow(/permission denied/);
  await expect(limited.query('CREATE TABLE yard.extra (id int)')).rejects.toThrow(/permission denied/);
  await expect(setupYardRoles(pool, { ...roles, password: 'short' })).rejects.toThrow(
    'Yard runtime password must be at least 32 characters',
  );
});
