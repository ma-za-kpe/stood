import type { FundingOperation, FundingStore } from '../ports/funding-store.js';

// #77 operations: an owner closes a funding stuck in CREATING that never got a PayPal order (PayPal refused the
// create, before T-0295 made that fail on its own). It never calls PayPal. It is refused unless no order id was ever
// recorded and the funding is older than PayPal's own window for a lost create to surface, and a named person gives
// a reason, which is kept as the failure's reference.
export const CLOSE_AFTER_MS = 72 * 3_600_000;
export type CloseRefusal = 'NOT_CREATING' | 'HAS_ORDER' | 'TOO_RECENT' | 'NEEDS_NAME_AND_REASON';

export async function closeStuckFunding(
  store: Pick<FundingStore, 'load' | 'fail'>,
  key: string,
  input: Readonly<{ by: string; note: string; now: number }>,
): Promise<Readonly<{ before: FundingOperation['status']; outcome: 'FAILED' } | { refused: CloseRefusal }>> {
  const by = input.by.trim(),
    note = input.note.trim();
  if (!/^[A-Za-z0-9 ._-]{2,60}$/.test(by) || note.length < 8 || note.length > 120)
    return { refused: 'NEEDS_NAME_AND_REASON' };
  const funding = await store.load(key);
  if (funding.status !== 'CREATING') return { refused: 'NOT_CREATING' };
  if (funding.orderId !== null) return { refused: 'HAS_ORDER' };
  if (input.now - Date.parse(funding.createdAt) < CLOSE_AFTER_MS) return { refused: 'TOO_RECENT' };
  await store.fail(key, `closed by ${by}: ${note}`);
  return { before: funding.status, outcome: 'FAILED' };
}
