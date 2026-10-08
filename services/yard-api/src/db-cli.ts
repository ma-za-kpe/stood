import pg from 'pg';
import { migrateYard, setupYardRoles } from './adapters/db-postgres/setup.js';

// Operator tool (T-0214). Uses YARD_MIGRATION_DATABASE_URL, an owner-capable URL that yard-api never receives.
//   db-cli.js roles     once: create yard_owner and yard_runtime (password from YARD_RUNTIME_PASSWORD)
//   db-cli.js migrate   every release (Render pre-deploy): apply Yard's schema
const roles = { owner: 'yard_owner', runtime: 'yard_runtime' };
const url = process.env.YARD_MIGRATION_DATABASE_URL?.trim() ?? '';
const command = process.argv[2];
if (!url || (command !== 'roles' && command !== 'migrate')) {
  process.stderr.write('Usage: db-cli.js roles|migrate, with YARD_MIGRATION_DATABASE_URL set.\n');
  process.exit(2);
}
if ((process.env.YARD_ENV ?? 'local') === 'demo' && new URL(url).searchParams.get('sslmode') !== 'verify-full') {
  process.stderr.write('YARD_MIGRATION_DATABASE_URL must use sslmode=verify-full.\n');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  if (command === 'roles') await setupYardRoles(pool, { ...roles, password: process.env.YARD_RUNTIME_PASSWORD ?? '' });
  else await migrateYard(pool, roles);
  process.stdout.write(command === 'roles' ? 'Yard roles ready.\n' : 'Yard schema up to date.\n');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Yard database setup failed'}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
