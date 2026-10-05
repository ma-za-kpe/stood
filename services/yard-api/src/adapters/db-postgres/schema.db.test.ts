import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionYard } from './schema.js';

const suffix = randomUUID().replaceAll('-', '');
const name = `test_yard_${suffix}`;
const owner = `yard_owner_${suffix}`;
const runtime = `yard_runtime_${suffix}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const pool = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
const password = randomBytes(24).toString('hex');
const connection = new URL(`postgres://db:5432/${name}`);
connection.username = runtime;
connection.password = password;
const limited = new pg.Pool({ connectionString: connection.toString() });
async function provision(o = owner, r = runtime) {
  const client = await pool.connect();
  try {
    await provisionYard(client, o, r);
  } finally {
    client.release();
  }
}
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.query(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await admin.query(
    `CREATE ROLE ${runtime} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  await migrate(drizzle(pool), { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await limited.end();
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.query(`DROP ROLE ${runtime}`);
  await admin.query(`DROP ROLE ${owner}`);
  await admin.end();
});
describe('Yard schema and runtime permissions against real Stood migrations (T-0176)', () => {
  it('provisions idempotently with a separate schema owner and server migration timestamp', async () => {
    await provision();
    const before = (await pool.query('SELECT * FROM yard.schema_migrations')).rows;
    await provision();
    expect((await pool.query('SELECT * FROM yard.schema_migrations')).rows).toEqual(before);
    expect(before).toHaveLength(1);
    expect(Number.isFinite(new Date(before[0].created_at).getTime())).toBe(true);
    expect((await limited.query('SELECT version FROM yard.schema_migrations')).rows).toEqual([{ version: 0 }]);
  });
  it('denies every public Stood table and DDL from the real runtime connection', async () => {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
    expect(tables.length).toBeGreaterThan(5);
    for (const { tablename } of tables)
      for (const action of [`SELECT * FROM public.${tablename}`, `DELETE FROM public.${tablename}`])
        await expect(limited.query(action)).rejects.toThrow();
    for (const action of [
      'CREATE TABLE yard.unsafe (id int)',
      'CREATE TABLE public.unsafe (id int)',
      `SET ROLE ${owner}`,
      'INSERT INTO yard.schema_migrations(version) VALUES(1)',
    ])
      await expect(limited.query(action)).rejects.toThrow();
  });
  it('grants future Yard data access, without grants for schema ownership or truncation', async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET ROLE ${owner}`);
      await client.query('CREATE TABLE yard.work_orders_probe (id text PRIMARY KEY)');
    } finally {
      await client.query('RESET ROLE');
      client.release();
    }
    await limited.query("INSERT INTO yard.work_orders_probe VALUES('wo')");
    await limited.query("UPDATE yard.work_orders_probe SET id='wo2'");
    expect((await limited.query('SELECT * FROM yard.work_orders_probe')).rows).toEqual([{ id: 'wo2' }]);
    await expect(limited.query('TRUNCATE yard.work_orders_probe')).rejects.toThrow();
    await limited.query('DELETE FROM yard.work_orders_probe');
  });
  it('rejects broad grants or membership before changing permissions', async () => {
    await pool.query(`GRANT SELECT ON public.payment_streams TO ${runtime}`);
    await expect(provision()).rejects.toThrow('Stood');
    await pool.query(`REVOKE SELECT ON public.payment_streams FROM ${runtime}`);
    await admin.query(`GRANT ${owner} TO ${runtime}`);
    await expect(provision()).rejects.toThrow('membership');
    await admin.query(`REVOKE ${owner} FROM ${runtime}`);
    await admin.query(`ALTER ROLE ${runtime} BYPASSRLS`);
    await expect(provision()).rejects.toThrow('privileged');
    await admin.query(`ALTER ROLE ${runtime} NOBYPASSRLS`);
    await pool.query(
      'CREATE FUNCTION public.unsafe_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$',
    );
    await expect(provision()).rejects.toThrow('Stood');
    await pool.query('DROP FUNCTION public.unsafe_definer()');
  });
  it('rejects absent or invalid roles and a schema owned by another role', async () => {
    await expect(provision('missing_role')).rejects.toThrow();
    await expect(provision(owner, 'bad; DROP DATABASE stood')).rejects.toThrow();
    await expect(provision(owner, owner)).rejects.toThrow();
    await pool.query('ALTER SCHEMA yard OWNER TO stood');
    await expect(provision()).rejects.toThrow('owner');
    await pool.query(`ALTER SCHEMA yard OWNER TO ${owner}`);
  });
  it('rolls back a late migration fault without leaving a partial schema', async () => {
    await pool.query('DROP SCHEMA yard CASCADE');
    const client = await pool.connect();
    try {
      await expect(
        provisionYard(
          {
            query: async (...args: unknown[]) => {
              if (String(args[0]).startsWith('INSERT INTO yard.schema_migrations'))
                throw new Error('fixture migration failure');
              return Reflect.apply(client.query, client, args);
            },
          } as Pick<pg.PoolClient, 'query'>,
          owner,
          runtime,
        ),
      ).rejects.toThrow('fixture migration failure');
      expect((await pool.query("SELECT 1 FROM pg_namespace WHERE nspname='yard'")).rows).toHaveLength(0);
    } finally {
      client.release();
    }
  });
});
