import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { migrateYardEvents } from '../../../yard-api/src/adapters/db-postgres/events.js';
import { provisionYard } from '../../../yard-api/src/adapters/db-postgres/schema.js';

if (process.env.NETWORK_MOCK !== 'true' || process.env.APP_ENV !== 'ci') throw new Error('Mock initialization refused');
const pool = new pg.Pool({ connectionString: 'postgres://stood:stood_mock_only@db:5432/stood_mock' });
try {
  await migrate(drizzle(pool), { migrationsFolder: resolve('services/api/drizzle') });
  await pool.query('CREATE ROLE yard_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS');
  await pool.query(
    "CREATE ROLE yard_runtime LOGIN PASSWORD 'sim-yard-database-only' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS",
  );
  const c = await pool.connect();
  try {
    await provisionYard(c, 'yard_owner', 'yard_runtime');
  } finally {
    c.release();
  }
  await migrateYardEvents(pool, 'yard_owner');
  console.log('Isolated mock database initialized. No real keys or money.');
} finally {
  await pool.end();
}
