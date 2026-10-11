import { expect, it, vi } from 'vitest';
import { advancePending } from './pending-work.js';

// T-0260: each worker tick moves every unfinished mandate and funding one step through its tested use case.
// One stuck item never stops the others.
it('advances every unresolved mandate and funding, isolating failures', async () => {
  const mandate = vi.fn(async (key: string) => {
    if (key === 'm-broken') throw new Error('provider down');
    return { before: 'RESERVED', after: 'AWAITING_APPROVAL' };
  });
  // Second audit (2026-10-11): FAILED was counted as advanced, and an unchanged AWAITING_APPROVAL too.
  const fund = vi.fn(async (key: string) =>
    key === 'f-stuck'
      ? { before: 'CREATING', after: 'CREATING' }
      : key === 'f-waiting'
        ? { before: 'AWAITING_APPROVAL', after: 'AWAITING_APPROVAL' }
        : key === 'f-refused'
          ? { before: 'CREATING', after: 'FAILED' }
          : { before: 'CREATING', after: 'HELD' },
  );
  const result = await advancePending({
    mandates: { unresolved: async () => ['m-1', 'm-broken', 'm-2'] },
    fundings: { unresolved: async () => ['f-1', 'f-stuck', 'f-waiting', 'f-refused'] },
    mandate,
    fund,
  });
  // Only a real state change advances; a refusal is a failure; unchanged is waiting.
  expect(result).toEqual({ mandates: 2, fundings: 1, waiting: 2, failed: 2 });
  expect(mandate.mock.calls.map(([k]) => k)).toEqual(['m-1', 'm-broken', 'm-2']);
  expect(fund).toHaveBeenCalledWith('f-1');
  const none = await advancePending({
    mandates: {
      unresolved: async () => {
        throw new Error('db down');
      },
    },
    fundings: { unresolved: async () => [] },
    mandate,
    fund,
  });
  expect(none).toEqual({ mandates: 0, fundings: 0, waiting: 0, failed: 1 });
});
