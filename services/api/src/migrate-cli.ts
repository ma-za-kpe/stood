import { databaseUrlProblem } from './adapters/db-postgres/connection-policy.js';
import { applyMigrations } from './adapters/db-postgres/migrate.js';

// Release step (T-0253): stood-reconciler's Render pre-deploy command. A failure exits non-zero, which
// stops the deploy, so no release goes live before its migrations.
const url = process.env.DATABASE_URL?.trim();
if (!url) {
  process.stderr.write('Migrations need DATABASE_URL.\n');
  process.exit(2);
}
const problem = databaseUrlProblem(url, process.env.APP_ENV ?? 'local');
if (problem) {
  process.stderr.write(`${problem}. Migrations did not run.\n`);
  process.exit(2);
}
try {
  const { applied } = await applyMigrations(url, 'drizzle');
  process.stdout.write(`Migrations: ${applied} applied, database up to date.\n`);
} catch {
  process.stderr.write('Migrations failed; the deploy stops here. No partial release goes live.\n');
  process.exit(1);
}
