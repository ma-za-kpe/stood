import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './adapters/db-postgres/schema.js';
import { PostgresTranches } from './adapters/db-postgres/tranches.js';
import { reconciliationRuntime } from './reconciliation-runtime.js';
import { fundingRecovery } from './signing-worker.js';

// Operator tool (#77): recover one funding stuck in CREATING from a PayPal order id the operator found, for example in
// the PayPal sandbox dashboard or with the PayPal MCP. Stood reads the order from PayPal and accepts it only if PayPal
// shows it belongs to this funding; it never creates or re-sends anything. Prints the funding's status before and
// after, never a setting.
const [key, orderId] = process.argv.slice(2);
if (!key || !orderId) {
  process.stdout.write('Usage: scripts/dev funding-recover <funding key> <PayPal order id>\n');
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
try {
  const providers = await reconciliationRuntime(process.env);
  const db = drizzle(pool, { schema });
  const recover = fundingRecovery({
    db,
    transport: providers.transport,
    tranches: new PostgresTranches(db),
    vaultKeys: process.env.VAULT_TOKEN_KEYS ?? '',
    clock: providers.clock,
  });
  const { before, outcome } = await recover(key, orderId);
  process.stdout.write(`Funding ${key}: ${before} -> ${outcome}.\n`);
  if (outcome === 'WAIT')
    process.stdout.write(
      'Unchanged: PayPal did not show that order as this funding (or did not answer). Nothing was sent.\n',
    );
} catch (error) {
  process.stdout.write(
    `Funding recovery failed: ${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}.\n`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
