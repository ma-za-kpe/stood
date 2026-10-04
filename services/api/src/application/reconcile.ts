import { advanceTrancheRecord, restoreTrancheRecord, type TrancheCommand } from '../domain/tranche-record.js';
import type { ProviderStatusReader } from '../ports/provider-status-reader.js';
import { type StoredTranche, type TrancheStore, TrancheStoreError } from '../ports/tranche-store.js';

type Result = Readonly<{ status: 'WAIT' | 'RETRY' | 'RESOLVED' | 'IDLE' | 'EXPIRED_RESERVED'; alert?: boolean }>;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : null;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function commandFor(snapshot: StoredTranche, value: unknown, now: number): TrancheCommand | null {
  const pending = snapshot.pending;
  const proof = object(value);
  if (
    !pending ||
    !proof ||
    proof.complete !== true ||
    !text(proof.reference) ||
    proof.operationKey !== pending.operation.key ||
    proof.authorizationId !== pending.operation.authorizationId ||
    proof.providerRequestId !== pending.providerRequestId
  )
    return null;
  if (
    (proof.outcome === 'CAPTURED' && proof.noCapture !== false) ||
    (proof.outcome === 'RENEWED' && proof.noRenewal !== false)
  )
    return null;
  const operation = pending.operation;
  const identity = { effect: operation.effect, authorizationId: operation.authorizationId, reference: proof.reference };
  if (operation.effect === 'CAPTURE' && proof.outcome === 'CAPTURED' && proof.noRenewal === true) {
    const amount = object(proof.amount);
    const tranche = restoreTrancheRecord(snapshot.record);
    if (!amount || amount.minor !== Number(tranche.amount.minor) || amount.currency !== tranche.amount.currency)
      return null;
    return { method: 'confirmSettlement', args: [{ ...identity, effect: 'CAPTURE' }] };
  }
  if (proof.noCapture !== true || (proof.noRenewal !== true && proof.outcome !== 'RENEWED')) return null;
  if (operation.effect === 'REAUTHORIZE') {
    const renewal = { ...identity, effect: 'REAUTHORIZE' as const, key: operation.key };
    if (proof.outcome === 'EXPIRED')
      return { method: 'confirmNoRenewalExpiry', args: [{ ...renewal, kind: 'NO_RENEWAL_EXPIRED', now }] };
    if (proof.outcome === 'NOT_RENEWED')
      return { method: 'reauthorizationFailed', args: [{ ...renewal, kind: 'REJECTED_NO_REAUTHORIZATION' }] };
    const renewed = object(proof.renewed);
    if (
      proof.outcome === 'RENEWED' &&
      renewed &&
      text(renewed.authorizationId) &&
      typeof renewed.confirmedAt === 'number' &&
      typeof renewed.expiresAt === 'number'
    )
      return {
        method: 'confirmReauthorization',
        args: [
          {
            ...renewal,
            previousAuthorizationId: operation.authorizationId,
            authorizationId: renewed.authorizationId,
            confirmedAt: renewed.confirmedAt,
            expiresAt: renewed.expiresAt,
          },
        ],
      };
    return null;
  }
  if (operation.effect === 'VOID' && proof.outcome === 'VOIDED')
    return { method: 'confirmSettlement', args: [{ ...identity, effect: 'VOID' }] };
  if (proof.outcome === 'EXPIRED')
    return {
      method: 'settlementFailed',
      args: [{ ...identity, effect: operation.effect, kind: 'AUTHORIZATION_EXPIRED' }],
    };
  if (operation.effect === 'CAPTURE' && proof.outcome === 'DECLINED')
    return { method: 'settlementFailed', args: [{ ...identity, effect: 'CAPTURE', kind: 'DECLINED' }] };
  return null;
}

async function expireIfDue(store: TrancheStore, snapshot: StoredTranche, now: number): Promise<boolean> {
  const tranche = restoreTrancheRecord(snapshot.record);
  if (
    !snapshot.pending &&
    ['HELD', 'DECIDING', 'WAITING'].includes(tranche.state) &&
    now >= tranche.currentHold.expiresAt
  ) {
    await store.apply(snapshot.trancheId, snapshot.version, `expiry:${tranche.currentHold.authorizationId}:${now}`, {
      method: 'expire',
      args: [now],
    });
    return true;
  }
  return false;
}

export async function reconcile(
  store: TrancheStore,
  reader: ProviderStatusReader,
  trancheId: string,
  now: number,
): Promise<Result> {
  if (!Number.isFinite(now)) return { status: 'WAIT', alert: true };
  const snapshot = await store.load(trancheId);
  try {
    if (!snapshot.pending) return { status: (await expireIfDue(store, snapshot, now)) ? 'EXPIRED_RESERVED' : 'IDLE' };
    let value: unknown;
    try {
      value = await reader.read(snapshot.pending);
    } catch {
      return { status: 'WAIT', alert: true };
    }
    const command = commandFor(snapshot, value, now);
    if (!command) return { status: 'WAIT', alert: true };
    // Validate the untrusted candidate without writes; malformed provider times,
    // identities and impossible transitions retain the existing reservation.
    try {
      advanceTrancheRecord(snapshot.record, command);
    } catch {
      return { status: 'WAIT', alert: true };
    }
    const proof = value as ObjectValue;
    const next = await store.apply(
      trancheId,
      snapshot.version,
      `lookup:${snapshot.pending.operation.key}:${String(proof.outcome)}:${String(proof.reference)}:${now}`,
      command,
    );
    await expireIfDue(store, next, now);
    return { status: 'RESOLVED' };
  } catch (error) {
    if (error instanceof TrancheStoreError && error.code === 'STALE_VERSION') return { status: 'RETRY' };
    throw error;
  }
}
