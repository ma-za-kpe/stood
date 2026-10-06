import { restoreTrancheRecord } from '../domain/tranche-record.js';
import type { PaymentExecutor } from '../ports/payment-executor.js';
import type { ProviderStatusReader } from '../ports/provider-status-reader.js';
import type { ReconciliationQueue } from '../ports/reconciliation-queue.js';
import type { TrancheStore } from '../ports/tranche-store.js';
import { executePayment } from './execute-payment.js';
import { reconcile } from './reconcile.js';
import { retryCapture } from './retry-capture.js';

export async function reconciliationTick(
  store: TrancheStore,
  reader: ProviderStatusReader,
  queue: ReconciliationQueue,
  options: Readonly<{ owner: string; clock(): number; executor?: PaymentExecutor }>,
  limit = 10,
) {
  const now = options.clock();
  if (!options.owner.trim() || !Number.isFinite(now) || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError('Invalid reconciliation configuration');
  await queue.seed();
  const result = { processed: 0, waiting: 0, failed: 0 };
  for (let index = 0; index < limit; index++) {
    const job = await queue.claim();
    if (!job) break;
    result.processed++;
    let delay = 60;
    try {
      const cancelSafeHold = async () => {
        let snapshot = await store.load(job.trancheId);
        const tranche = restoreTrancheRecord(snapshot.record);
        if (tranche.safeRecovery && !snapshot.pending && ['HELD', 'DECIDING', 'WAITING'].includes(tranche.state))
          snapshot = await store.apply(job.trancheId, snapshot.version, `safe-cancel:${job.token}`, {
            method: 'cancel',
            args: [options.clock()],
          });
        if (snapshot.pending?.operation.effect === 'VOID' && snapshot.pending.operation.target === 'CANCELLED')
          await queue.alert({
            trancheId: job.trancheId,
            operationKey: snapshot.pending.operation.key,
            code: 'SAFE_CANCEL_REQUESTED',
            owner: options.owner,
          });
      };
      await cancelSafeHold();
      await reconcile(store, reader, job.trancheId, options.clock());
      await cancelSafeHold();
      if (options.executor) {
        await executePayment(store, options.executor, job.trancheId, job.token, options.clock);
        await reconcile(store, reader, job.trancheId, options.clock());
        await retryCapture(store, reader, options.executor, job.trancheId, job.token, options.clock);
      }
      const snapshot = await store.load(job.trancheId);
      if (snapshot.pending) {
        result.waiting++;
        const alert = { trancheId: job.trancheId, operationKey: snapshot.pending.operation.key, owner: options.owner };
        await queue.alert({ ...alert, code: 'PROVIDER_UNKNOWN' });
        if (options.clock() - Date.parse(snapshot.pending.createdAt) >= 3 * 3600000)
          await queue.alert({ ...alert, code: 'UNRESOLVED_3H' });
      } else {
        await queue.resolve(job.trancheId);
        delay = 3600;
      }
    } catch {
      result.failed++;
      await queue.alert({ trancheId: job.trancheId, operationKey: null, code: 'WORKER_FAILURE', owner: options.owner });
    } finally {
      await queue.finish(job, delay);
    }
  }
  return Object.freeze(result);
}
