import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PostgresFunding } from './adapters/db-postgres/funding.js';
import * as schema from './adapters/db-postgres/schema.js';
import { closeStuckFunding } from './application/funding-close.js';

// Operator tool (#77): close a funding stuck in CREATING that never got a PayPal order. It calls nothing at PayPal.
// Usage: scripts/dev funding-close <funding key> --by <name> --note "<rejection evidence>" --provider-create-rejected. Prints the status only.
const [key, ...rest] = process.argv.slice(2);
const flag = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? (rest[i + 1] ?? '') : '';
};
if (!key) {
  process.stdout.write(
    'Usage: scripts/dev funding-close <funding key> --by <name> --note "<rejection evidence>" --provider-create-rejected\n',
  );
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const result = await closeStuckFunding(new PostgresFunding(drizzle(pool, { schema })), key, {
    by: flag('--by'),
    note: flag('--note'),
    now: Date.now(),
    ...(rest.includes('--provider-create-rejected') ? { providerOutcome: 'CREATE_REJECTED' as const } : {}),
  });
  if ('refused' in result) {
    process.stdout.write(`Funding ${key}: unchanged (${result.refused}). Nothing was written.\n`);
    process.exitCode = 1;
  } else process.stdout.write(`Funding ${key}: ${result.before} -> ${result.outcome}.\n`);
} catch {
  process.stdout.write('Funding close failed; inspect private operator logs.\n');
  process.exitCode = 1;
} finally {
  await pool.end();
}
