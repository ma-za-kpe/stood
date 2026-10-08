import { setTimeout } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { confirmedCaptures } from './adapters/db-postgres/ledger-captures.js';
import { PostgresReconciliationFindings } from './adapters/db-postgres/reconciliation-findings.js';
import { PostgresReconciliationQueue } from './adapters/db-postgres/reconciliation-queue.js';
import * as schema from './adapters/db-postgres/schema.js';
import { PostgresTranches } from './adapters/db-postgres/tranches.js';
import { PayPalAdapter } from './adapters/payments-paypal/adapter.js';
import { runReconciliationAudit } from './application/reconciliation-audit-run.js';
import { reconciliationTick } from './application/reconciliation-worker.js';
import type { ProviderTransactions } from './ports/provider-transactions.js';
import { reconciliationRuntime } from './reconciliation-runtime.js';

const required = ['DATABASE_URL', 'PROVIDER_PAYPAL', 'RECONCILIATION_OWNER'] as const;
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length) {
  process.stderr.write(`Reconciliation is off. Add: ${missing.join(', ')}. See docs/USAGE.md.\n`);
  process.exitCode = 1;
} else {
  const abort = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => abort.abort());
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const store = new PostgresTranches(drizzle(pool, { schema }));
    const providers = await reconciliationRuntime(process.env);
    const reader = new PayPalAdapter(providers.transport, store, providers.clock);
    const queue = new PostgresReconciliationQueue(pool);
    const db = drizzle(pool, { schema });
    const findings = new PostgresReconciliationFindings(db);
    // T-0155: hourly ledger-versus-PayPal audit. Isolated: an audit failure never stops reconciliation.
    const search = providers.transport as Partial<ProviderTransactions>;
    let lastAudit = 0;
    while (!abort.signal.aborted) {
      const now = await providers.clock();
      const result = await reconciliationTick(store, reader, queue, {
        owner: process.env.RECONCILIATION_OWNER ?? '',
        clock: () => now,
      });
      process.stdout.write(
        `Reconciliation: ${result.processed} processed, ${result.waiting} waiting, ${result.failed} failed.\n`,
      );
      if (search.captures && now - lastAudit >= 3600000) {
        lastAudit = now;
        try {
          const audit = await runReconciliationAudit({
            ledger: () => confirmedCaptures(db),
            provider: search as ProviderTransactions,
            findings,
            owner: process.env.RECONCILIATION_OWNER ?? '',
            now,
          });
          process.stdout.write(`Audit: ${audit.checked} captures checked, ${audit.findings} findings open.\n`);
        } catch {
          process.stderr.write('Audit unavailable this hour; reconciliation continues.\n');
        }
      }
      await setTimeout(15000, undefined, { signal: abort.signal });
    }
  } catch {
    if (!abort.signal.aborted) {
      process.stderr.write(
        'Reconciliation stopped. Check database migrations, sandbox configuration and the assigned reviewer.\n',
      );
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}
