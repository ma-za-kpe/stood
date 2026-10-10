import { setTimeout } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PostgresBaselines } from './adapters/db-postgres/baselines.js';
import { databaseUrlProblem } from './adapters/db-postgres/connection-policy.js';
import { confirmedCaptures } from './adapters/db-postgres/ledger-captures.js';
import { PostgresReconciliationFindings } from './adapters/db-postgres/reconciliation-findings.js';
import { PostgresReconciliationQueue } from './adapters/db-postgres/reconciliation-queue.js';
import { PostgresRunClaims } from './adapters/db-postgres/run-claims.js';
import { PostgresRunnerJobs } from './adapters/db-postgres/runner-jobs.js';
import * as schema from './adapters/db-postgres/schema.js';
import { PostgresTranches } from './adapters/db-postgres/tranches.js';
import { GitHubRepositoryReader } from './adapters/github/repository-reader.js';
import { PayPalAdapter } from './adapters/payments-paypal/adapter.js';
import { reportSigner } from './adapters/runner/report-signer.js';
import { VercelSandboxRunner } from './adapters/runner/vercel-sandbox.js';
import { vercelSandbox } from './adapters/runner/vercel-sdk.js';
import { runBaseline } from './application/baseline-run.js';
import { runClaimed } from './application/claimed-queue.js';
import { runCodeJob } from './application/code-run.js';
import { runReconciliationAudit } from './application/reconciliation-audit-run.js';
import { reconciliationTick } from './application/reconciliation-worker.js';
import type { ProviderTransactions } from './ports/provider-transactions.js';
import { reconciliationRuntime } from './reconciliation-runtime.js';
import { RUNNER_ID, RUNNER_IMAGE, runnerSettings } from './runner-runtime.js';
import { signingWorker } from './signing-worker.js';

const required = ['DATABASE_URL', 'PROVIDER_PAYPAL', 'RECONCILIATION_OWNER'] as const;
const missing = required.filter((key) => !process.env[key]?.trim());
const problem = databaseUrlProblem(process.env.DATABASE_URL ?? '', process.env.APP_ENV ?? 'local');
if (!missing.length && problem) {
  process.stderr.write(`Reconciliation is off: ${problem}. See docs/SETUP.md.\n`);
  process.exitCode = 1;
} else if (missing.length) {
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
    // T-0260: saved-PayPal mandates and tranche funding, advanced by their own use cases each tick.
    let pending: ReturnType<typeof signingWorker> | null = null;
    try {
      pending = signingWorker({
        db,
        transport: providers.transport,
        tranches: store,
        vaultKeys: process.env.VAULT_TOKEN_KEYS ?? '',
        clock: providers.clock,
      });
    } catch {
      process.stderr.write('Signing and funding off: VAULT_TOKEN_KEYS is missing or invalid. See docs/SETUP.md.\n');
    }
    // T-0159 (ADR-0026): the code runner and settlement execution are explicit switches; the log names what is off.
    const settings = runnerSettings(process.env);
    for (const note of settings.notes) process.stdout.write(`${note}\n`);
    const runner = settings.runner;
    if (runner) {
      const jobs = new PostgresRunnerJobs(db);
      const baselines = new PostgresBaselines(db);
      const claims = new PostgresRunClaims(db);
      const deps = {
        store,
        reader: new GitHubRepositoryReader(
          process.env.GITHUB_READ_TOKEN?.trim() ? { token: process.env.GITHUB_READ_TOKEN.trim() } : {},
        ),
        runner: new VercelSandboxRunner(vercelSandbox),
        signer: reportSigner(runner.key),
        verifier: runner.verifier,
        evidence: runner.evidence,
        runnerId: RUNNER_ID,
        imageDigest: RUNNER_IMAGE,
        clock: () => Date.now(),
      };
      // A run takes minutes, so it has its own loop beside reconciliation instead of stalling the 15-second tick.
      void (async () => {
        while (!abort.signal.aborted) {
          try {
            const decided = await runClaimed(
              claims,
              'package',
              await jobs.pending(50),
              (job) => `${job.usageConfirmed ? 'usage' : 'run'}:${job.packageId}`,
              2,
              (job) => runCodeJob(job, deps),
            );
            for (const r of decided) process.stdout.write(`Code runner: package ${r.id} ${r.outcome}.\n`);
          } catch {
            process.stdout.write('Code runner: queue unavailable.\n');
          }
          // C4 (#77): baselines use the same runner, after the packages waiting on money.
          try {
            const ran = await runClaimed(
              claims,
              'baseline',
              await baselines.pending(50),
              (job) => job.id,
              2,
              (job) => runBaseline(job, { ...deps, store: baselines }),
            );
            for (const r of ran) process.stdout.write(`Code runner: baseline ${r.id} ${r.outcome}.\n`);
          } catch {
            process.stdout.write('Code runner: baseline queue unavailable.\n');
          }
          await setTimeout(60_000, undefined, { signal: abort.signal }).catch(() => undefined);
        }
      })();
    }
    let lastAudit = 0;
    while (!abort.signal.aborted) {
      const now = await providers.clock();
      const result = await reconciliationTick(store, reader, queue, {
        owner: process.env.RECONCILIATION_OWNER ?? '',
        clock: () => now,
        // Captures or voids a decided tranche only when the owner switched settlement on.
        ...(settings.settle ? { executor: reader } : {}),
      });
      process.stdout.write(
        `Reconciliation: ${result.processed} processed, ${result.waiting} waiting, ${result.failed} failed.\n`,
      );
      if (pending) {
        const moved = await pending();
        if (moved.mandates || moved.fundings || moved.waiting || moved.failed)
          process.stdout.write(
            `Signing and funding: ${moved.mandates} mandates and ${moved.fundings} fundings advanced, ${moved.waiting} waiting, ${moved.failed} failed.\n`,
          );
      }
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
