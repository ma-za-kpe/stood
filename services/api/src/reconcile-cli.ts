import { setTimeout } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PostgresReconciliationQueue } from './adapters/db-postgres/reconciliation-queue.js';
import * as schema from './adapters/db-postgres/schema.js';
import { PostgresTranches } from './adapters/db-postgres/tranches.js';
import { PayPalAdapter } from './adapters/payments-paypal/adapter.js';
import { ServerSdkTransport } from './adapters/payments-paypal/sdk.js';
import { reconciliationTick } from './application/reconciliation-worker.js';

const required = ['DATABASE_URL', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'RECONCILIATION_OWNER'] as const;
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
    const reader = new PayPalAdapter(
      new ServerSdkTransport({
        appEnv: process.env.APP_ENV ?? 'local',
        baseUrl: process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com',
        clientId: process.env.PAYPAL_CLIENT_ID ?? '',
        clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
      }),
      store,
    );
    const queue = new PostgresReconciliationQueue(pool);
    while (!abort.signal.aborted) {
      const result = await reconciliationTick(store, reader, queue, {
        owner: process.env.RECONCILIATION_OWNER ?? '',
        clock: Date.now,
      });
      process.stdout.write(
        `Reconciliation: ${result.processed} processed, ${result.waiting} waiting, ${result.failed} failed.\n`,
      );
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
