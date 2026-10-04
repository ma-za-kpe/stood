import { captureAllowedAt } from '../domain/hold-policy.js';
import { advanceTrancheRecord, restoreTrancheRecord, type TrancheCommand } from '../domain/tranche-record.js';
import type { PaymentExecutor, PaymentResult } from '../ports/payment-executor.js';
import { type TrancheStore, TrancheStoreError } from '../ports/tranche-store.js';
export async function executePayment(
  store: TrancheStore,
  executor: PaymentExecutor,
  id: string,
  claimId: string,
  clock: () => number,
): Promise<'DONE' | 'WAIT' | 'RESOLVED' | 'NOT_SUBMITTED'> {
  const now = clock();
  if (!claimId.trim() || !Number.isFinite(now)) return 'WAIT';
  const snapshot = await store.load(id);
  const pending = snapshot.pending;
  if (!pending) return 'DONE';
  const tranche = restoreTrancheRecord(snapshot.record);
  if (
    pending.status !== 'RESERVED' ||
    !tranche.canSubmitPendingOperation ||
    (tranche.profileId === 'rental.return@1' && tranche.pendingOperation?.target === 'RELEASED')
  )
    return 'WAIT';
  const operation = pending.operation;
  const identity = { effect: operation.effect, authorizationId: operation.authorizationId };
  try {
    if (operation.effect !== 'VOID' && !captureAllowedAt(tranche.currentHold.expiresAt, now)) {
      const failure: TrancheCommand =
        operation.effect === 'REAUTHORIZE'
          ? {
              method: 'reauthorizationFailed',
              args: [
                {
                  ...identity,
                  effect: 'REAUTHORIZE',
                  key: operation.key,
                  kind: 'REJECTED_NO_REAUTHORIZATION',
                  reference: 'local_never_submitted',
                },
              ],
            }
          : {
              method: 'settlementFailed',
              args: [
                { ...identity, effect: 'CAPTURE', kind: 'REJECTED_NO_PAYMENT', reference: 'local_never_submitted' },
              ],
            };
      await store.apply(id, snapshot.version, `not-submitted:${operation.key}`, failure);
      return 'NOT_SUBMITTED';
    }
    const claim: TrancheCommand =
      operation.effect === 'REAUTHORIZE'
        ? {
            method: 'reauthorizationFailed',
            args: [{ ...identity, effect: 'REAUTHORIZE', key: operation.key, kind: 'AMBIGUOUS' }],
          }
        : { method: 'settlementFailed', args: [{ ...identity, effect: operation.effect, kind: 'AMBIGUOUS' }] };
    const claimed = await store.apply(id, snapshot.version, `submission:${operation.key}:${claimId}`, claim);
    const immediate = clock();
    if (
      !Number.isFinite(immediate) ||
      (operation.effect !== 'VOID' && !captureAllowedAt(tranche.currentHold.expiresAt, immediate))
    )
      return 'WAIT';
    let result: PaymentResult | null;
    try {
      result = await executor.execute(claimed);
    } catch {
      return 'WAIT';
    }
    if (!result) return 'WAIT';
    try {
      advanceTrancheRecord(claimed.record, result);
    } catch {
      return 'WAIT';
    }
    await store.apply(id, claimed.version, `response:${operation.key}:${claimId}`, result);
    return 'RESOLVED';
  } catch (error) {
    if (error instanceof TrancheStoreError && error.code === 'STALE_VERSION') return 'WAIT';
    throw error;
  }
}
