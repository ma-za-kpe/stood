import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { provisionYard } from '../src/adapters/db-postgres/schema.js';
export async function yardDatabase() {
  const suffix = randomUUID().replaceAll('-', '');
  const name = `test_yard_${suffix}`,
    owner = `yo_${suffix}`,
    runtime = `yr_${suffix}`;
  const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
  const pool = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
  const password = randomBytes(24).toString('hex');
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.query(`CREATE ROLE ${owner} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
  await admin.query(
    `CREATE ROLE ${runtime} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
  );
  const client = await pool.connect();
  try {
    await provisionYard(client, owner, runtime);
  } finally {
    client.release();
  }
  const url = new URL(`postgres://db:5432/${name}`);
  url.username = runtime;
  url.password = password;
  const limited = new pg.Pool({ connectionString: url.toString() });
  return {
    pool,
    limited,
    owner,
    runtime,
    close: async () => {
      await limited.end();
      await pool.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.query(`DROP ROLE ${runtime}`);
      await admin.query(`DROP ROLE ${owner}`);
      await admin.end();
    },
  };
}
