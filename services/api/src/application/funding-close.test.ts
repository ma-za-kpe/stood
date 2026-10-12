import { describe, expect, it, vi } from 'vitest';
import type { FundingOperation } from '../ports/funding-store.js';
import { CLOSE_AFTER_MS, closeStuckFunding } from './funding-close.js';

const created = Date.parse('2026-10-10T13:30:01Z');
const operation = (patch: Partial<FundingOperation> = {}) =>
  ({
    key: 'f',
    trancheId: 't',
    status: 'CREATING',
    orderId: null,
    createdAt: new Date(created).toISOString(),
    ...patch,
  }) as FundingOperation;
const store = (row: FundingOperation) => ({ load: vi.fn(async () => row), fail: vi.fn(async () => row) });
const input = { by: 'owner', note: 'PayPal refused the payee before T-0295', now: created + CLOSE_AFTER_MS };

// #77: closing a funding that never got a PayPal order, without calling PayPal.
describe('closing a stuck funding', () => {
  it('fails a CREATING funding with no order after 72 hours, keeping who and why', async () => {
    const s = store(operation());
    expect(await closeStuckFunding(s, 'f', input)).toEqual({ before: 'CREATING', outcome: 'FAILED' });
    expect(s.fail).toHaveBeenCalledWith('f', 'closed by owner: PayPal refused the payee before T-0295');
  });
  it('refuses anything that might have a PayPal order or is still recent, and never writes', async () => {
    const cases: [FundingOperation, typeof input, string][] = [
      [operation({ status: 'AWAITING_APPROVAL' }), input, 'NOT_CREATING'],
      [operation({ orderId: 'ORDER1' }), input, 'HAS_ORDER'],
      [operation(), { ...input, now: created + CLOSE_AFTER_MS - 1 }, 'TOO_RECENT'],
      [operation(), { ...input, by: '' }, 'NEEDS_NAME_AND_REASON'],
      [operation(), { ...input, note: 'short' }, 'NEEDS_NAME_AND_REASON'],
    ];
    for (const [row, given, refused] of cases) {
      const s = store(row);
      expect(await closeStuckFunding(s, 'f', given)).toEqual({ refused });
      expect(s.fail).not.toHaveBeenCalled();
    }
  });
});
