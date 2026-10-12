import type { FundingOperation, FundingStore } from '../ports/funding-store.js';

// Operator close-out requires a reviewed, definitive provider create rejection. The delay is an operator
// policy, not proof that PayPal created no order. The store checks the read's version/state under its lock.
export const CLOSE_AFTER_MS = 72 * 3_600_000;
export type CloseRefusal =
  | 'NOT_CREATING'
  | 'HAS_ORDER'
  | 'TOO_RECENT'
  | 'NEEDS_NAME_AND_REASON'
  | 'INVALID_TIME'
  | 'NEEDS_PROVIDER_REJECTION';

export async function closeStuckFunding(
  store: Pick<FundingStore, 'load' | 'fail'>,
  key: string,
  input: Readonly<{ by: string; note: string; now: number; providerOutcome?: 'CREATE_REJECTED' }>,
): Promise<Readonly<{ before: FundingOperation['status']; outcome: 'FAILED' } | { refused: CloseRefusal }>> {
  const by = input.by.trim(),
    note = input.note.trim();
  if (!/^[A-Za-z0-9 ._-]{2,60}$/.test(by) || note.length < 8 || note.length > 120)
    return { refused: 'NEEDS_NAME_AND_REASON' };
  if (input.providerOutcome !== 'CREATE_REJECTED') return { refused: 'NEEDS_PROVIDER_REJECTION' };
  const funding = await store.load(key);
  if (funding.status !== 'CREATING') return { refused: 'NOT_CREATING' };
  if (funding.orderId !== null) return { refused: 'HAS_ORDER' };
  const createdAt = Date.parse(funding.createdAt);
  if (!Number.isSafeInteger(input.now) || input.now < 0 || !Number.isSafeInteger(createdAt) || createdAt < 0)
    return { refused: 'INVALID_TIME' };
  if (input.now - createdAt < CLOSE_AFTER_MS) return { refused: 'TOO_RECENT' };
  await store.fail(key, `closed by ${by}: ${note}`, { version: funding.version, status: 'CREATING', orderId: null });
  return { before: funding.status, outcome: 'FAILED' };
}
