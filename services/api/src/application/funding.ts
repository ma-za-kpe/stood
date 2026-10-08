import { restoreTrancheRecord } from '../domain/tranche-record.js';
import type { FundingAuthority, FundingProvider } from '../ports/funding-provider.js';
import type { FundingHold, FundingOperation, FundingStore } from '../ports/funding-store.js';
import type { TrancheStore } from '../ports/tranche-store.js';

type Result = 'WAIT' | 'AWAITING_APPROVAL' | 'HELD' | 'FAILED' | 'EXPIRED';
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 200;
function matching(value: unknown, operation: FundingOperation): Record<string, unknown> | null {
  const p = object(value);
  return p?.complete === true &&
    p.key === operation.key &&
    p.trancheId === operation.trancheId &&
    p.createRequestId === operation.createRequestId &&
    p.authorizeRequestId === operation.authorizeRequestId &&
    text(p.orderId) &&
    (!operation.orderId || p.orderId === operation.orderId)
    ? p
    : null;
}
function held(value: unknown, orderId: string, now: number, expired: boolean): FundingHold | null {
  const p = object(value);
  if (
    !p ||
    p.orderId !== orderId ||
    !text(p.authorizationId) ||
    !text(p.reference) ||
    !Number.isSafeInteger(p.heldAt) ||
    (p.heldAt as number) < 0 ||
    (p.heldAt as number) > now ||
    !Number.isSafeInteger(p.expiresAt) ||
    (expired ? (p.expiresAt as number) > now : (p.expiresAt as number) <= now) ||
    (p.expiresAt as number) <= (p.heldAt as number) ||
    (p.expiresAt as number) - (p.heldAt as number) > 29 * 86400000
  )
    return null;
  return {
    orderId,
    authorizationId: p.authorizationId,
    reference: p.reference,
    heldAt: p.heldAt as number,
    expiresAt: p.expiresAt as number,
  };
}
// Every call uses a server-owned authority and clock. Unknown outcomes are read
// again; they never cause a fresh provider write or request ID.
export async function advanceFunding(
  store: FundingStore,
  tranches: Pick<TrancheStore, 'load'>,
  provider: FundingProvider,
  authority: FundingAuthority,
  key: string,
  clock: () => number | Promise<number>,
  candidateOrderId?: string,
): Promise<Result> {
  try {
    let operation = await store.load(key);
    if (operation.status === 'HELD' || operation.status === 'FAILED' || operation.status === 'EXPIRED')
      return operation.status;
    const permitted = async () => {
      const now = await clock();
      if (!Number.isSafeInteger(now) || now < 0) return false;
      const snapshot = await tranches.load(operation.trancheId);
      const tranche = restoreTrancheRecord(snapshot.record);
      return (
        snapshot.version === operation.instruction.expectedVersion &&
        !snapshot.pending &&
        !tranche.safeRecovery &&
        ['PENDING', 'WAIT_FUNDING'].includes(tranche.state) &&
        tranche.amount.currency === operation.instruction.amount.currency &&
        tranche.amount.toJSON().minor === operation.instruction.amount.minor &&
        (await authority.canFund(structuredClone(operation.instruction), now))
      );
    };
    // T-0154: a saved PayPal account is authorized when the order is created; there is no approval step.
    const saved = operation.instruction.source === 'SAVED_PAYPAL';
    const settleSaved = async (proof: Record<string, unknown>): Promise<Result> => {
      if (proof.outcome === 'DECLINED' && text(proof.reference)) {
        await store.fail(key, proof.reference);
        return 'FAILED';
      }
      const now = await clock();
      if (proof.outcome !== 'HELD' || !text(proof.orderId) || !Number.isSafeInteger(now) || now < 0) return 'WAIT';
      const hold = held(proof.hold, proof.orderId, now, false);
      if (!hold) return 'WAIT';
      await store.confirm(key, hold);
      return 'HELD';
    };
    if (operation.status === 'RESERVED') {
      if (!(await permitted())) return 'WAIT';
      operation = await store.beginCreate(key, operation.version);
      if (!(await permitted())) return 'WAIT';
      const proof = matching(await provider.create(structuredClone(operation)), operation);
      if (saved) return proof ? settleSaved(proof) : 'WAIT';
      if (!proof || proof.outcome !== 'CREATED' || typeof proof.approvalUrl !== 'string') return 'WAIT';
      await store.orderCreated(key, { orderId: proof.orderId as string, approvalUrl: proof.approvalUrl });
      return 'AWAITING_APPROVAL';
    }
    let proof = matching(await provider.read(structuredClone(operation), candidateOrderId), operation);
    if (!proof) return 'WAIT';
    if (operation.status === 'CREATING') {
      if (saved) return settleSaved(proof);
      if (!['CREATED', 'APPROVED'].includes(String(proof.outcome)) || typeof proof.approvalUrl !== 'string')
        return 'WAIT';
      await store.orderCreated(key, { orderId: proof.orderId as string, approvalUrl: proof.approvalUrl });
      return 'AWAITING_APPROVAL';
    }
    if (operation.status === 'AWAITING_APPROVAL') {
      if (proof.outcome === 'CREATED') return 'AWAITING_APPROVAL';
      if (proof.outcome !== 'APPROVED' || proof.approvalUrl !== operation.approvalUrl || !(await permitted()))
        return 'WAIT';
      operation = await store.beginAuthorize(key, operation.version);
      if (!(await permitted())) return 'WAIT';
      proof = matching(await provider.authorize(structuredClone(operation)), operation);
      if (!proof) return 'WAIT';
    }
    if (operation.status !== 'AUTHORIZING') return 'WAIT';
    if (proof.outcome === 'DECLINED' && text(proof.reference)) {
      await store.fail(key, proof.reference);
      return 'FAILED';
    }
    const now = await clock();
    if (!Number.isSafeInteger(now) || now < 0 || !['HELD', 'EXPIRED'].includes(String(proof.outcome))) return 'WAIT';
    const expired = proof.outcome === 'EXPIRED';
    const hold = held(proof.hold, operation.orderId!, now, expired);
    if (!hold) return 'WAIT';
    if (expired) {
      await store.expire(key, hold, now);
      return 'EXPIRED';
    }
    await store.confirm(key, hold);
    return 'HELD';
  } catch {
    // Includes lost response/commit, stale competing writers and unknown
    // authority. The durable phase identifies whether a call may have landed.
    return 'WAIT';
  }
}
