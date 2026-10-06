import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { migrateYardEvents } from '../../../yard-api/src/adapters/db-postgres/events.js';
import { migrateYardIntakes } from '../../../yard-api/src/adapters/db-postgres/intakes.js';
import { provisionYard } from '../../../yard-api/src/adapters/db-postgres/schema.js';
import { migrateYardSiteLogs } from '../../../yard-api/src/adapters/db-postgres/site-log.js';
import { PostgresSaver } from '../../../yard-foreman/test/fakes/checkpoint.js';

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
  await migrateYardIntakes(pool, 'yard_owner');
  await migrateYardSiteLogs(pool, 'yard_owner');
  await pool.query('GRANT CREATE ON DATABASE stood_mock TO yard_owner');
  const plannerMigration = new pg.Pool({
    connectionString: pool.options.connectionString,
    options: '-c role=yard_owner',
  });
  try {
    await new PostgresSaver(plannerMigration, undefined, { schema: 'yard' }).setup();
  } finally {
    await plannerMigration.end();
  }
  console.log('Isolated mock database initialized. No real keys or money.');
} finally {
  await pool.end();
}
