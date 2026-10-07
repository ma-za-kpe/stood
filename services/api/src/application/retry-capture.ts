import { randomUUID } from 'node:crypto';
import { CAPTURE_RETRY_PROOF_MAX_AGE_MS, captureAllowedAt } from '../domain/hold-policy.js';
import { advanceTrancheRecord, restoreTrancheRecord, type TrancheCommand } from '../domain/tranche-record.js';
import type { PaymentExecutor, PaymentResult } from '../ports/payment-executor.js';
import type { ProviderStatusReader } from '../ports/provider-status-reader.js';
import { type TrancheStore, TrancheStoreError } from '../ports/tranche-store.js';

const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export async function retryCapture(
  store: TrancheStore,
  reader: ProviderStatusReader,
  executor: PaymentExecutor,
  id: string,
  claimId: string,
  clock: () => number,
): Promise<'DONE' | 'WAIT' | 'RESOLVED'> {
  const start = clock();
  if (!claimId.trim() || !Number.isSafeInteger(start)) return 'WAIT';
  const snapshot = await store.load(id),
    pending = snapshot.pending;
  if (!pending) return 'DONE';
  const t = restoreTrancheRecord(snapshot.record);
  if (
    pending.status !== 'AMBIGUOUS' ||
    pending.operation.effect !== 'CAPTURE' ||
    !t.canSubmitPendingOperation ||
    t.captureRetryClaim !== null ||
    t.profileId === 'rental.return@1' ||
    start < t.currentHold.heldAt ||
    !captureAllowedAt(t.currentHold.expiresAt, start)
  )
    return 'WAIT';
  let value: unknown;
  try {
    value = await reader.read(pending);
  } catch {
    return 'WAIT';
  }
  const proof = object(value),
    amount = object(proof?.amount),
    now = clock();
  if (
    !proof ||
    proof.complete !== true ||
    proof.outcome !== 'NOT_CAPTURED' ||
    proof.noCapture !== true ||
    proof.noRenewal !== true ||
    proof.capturable !== true ||
    proof.operationKey !== pending.operation.key ||
    proof.authorizationId !== pending.operation.authorizationId ||
    proof.providerRequestId !== pending.providerRequestId ||
    proof.expiresAt !== t.currentHold.expiresAt ||
    typeof proof.reference !== 'string' ||
    !proof.reference.trim() ||
    !amount ||
    amount.minor !== Number(t.amount.minor) ||
    amount.currency !== t.amount.currency ||
    !Number.isSafeInteger(now) ||
    now < start ||
    typeof proof.observedAt !== 'number'
  )
    return 'WAIT';
  const attemptId = randomUUID();
  const command: TrancheCommand = {
    method: 'claimCaptureRetry',
    args: [
      {
        claimId: attemptId,
        effect: 'CAPTURE',
        operationKey: pending.operation.key,
        authorizationId: pending.operation.authorizationId,
        providerRequestId: pending.providerRequestId,
        reference: proof.reference,
        observedAt: proof.observedAt,
        now,
      },
    ],
  };
  try {
    advanceTrancheRecord(snapshot.record, command);
  } catch {
    return 'WAIT';
  }
  try {
    // Applying the claim atomically appends proof, consumes the retry and keeps
    // the operation ambiguous with its original request ID. A replay cannot
    // enter this call path again, even if the process stops immediately here.
    const claimed = await store.apply(
      id,
      snapshot.version,
      `capture-retry:${pending.operation.key}:${claimId}:${attemptId}`,
      command,
    );
    const immediate = clock();
    if (
      !Number.isSafeInteger(immediate) ||
      immediate < now ||
      immediate - proof.observedAt > CAPTURE_RETRY_PROOF_MAX_AGE_MS ||
      !captureAllowedAt(t.currentHold.expiresAt, immediate)
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
    const after = await store.apply(
      id,
      claimed.version,
      `capture-retry-response:${pending.operation.key}:${claimId}`,
      result,
    );
    return after.pending ? 'WAIT' : 'RESOLVED';
  } catch (error) {
    if (error instanceof TrancheStoreError && error.code === 'STALE_VERSION') return 'WAIT';
    throw error;
  }
}
