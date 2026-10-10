import { expect, it, vi } from 'vitest';
import { advancePending } from './pending-work.js';

// T-0260: each worker tick moves every unfinished mandate and funding one step through its tested use case.
// One stuck item never stops the others.
it('advances every unresolved mandate and funding, isolating failures', async () => {
  const mandate = vi.fn(async (key: string) => {
    if (key === 'm-broken') throw new Error('provider down');
  });
  const fund = vi.fn(async (key: string) => (key === 'f-stuck' ? 'WAIT' : 'HELD'));
  const result = await advancePending({
    mandates: { unresolved: async () => ['m-1', 'm-broken', 'm-2'] },
    fundings: { unresolved: async () => ['f-1', 'f-stuck'] },
    mandate,
    fund,
  });
  // A funding that only waited moved nothing, and is not counted as advanced.
  expect(result).toEqual({ mandates: 2, fundings: 1, waiting: 1, failed: 1 });
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
