import { describe, expect, it } from 'vitest';
import { allowanceDraft } from './allowance-draft.js';

const input = {
  payee_ref: 'builder',
  cap: { minor: 1000, currency: 'GBP' },
  milestones: [
    { name: 'foundation', amount: { minor: 1000, currency: 'GBP' }, profile: 'construction.stage@1', params: {} },
  ],
  window_days: 7,
  max_resubmits: 1,
};
describe('Draft creation boundary', () => {
  it('normalises names and validates the actual allowance invariants', () => {
    expect(allowanceDraft({ ...input, milestones: [{ ...input.milestones[0], name: ' foundation ' }] })).toEqual(input);
  });
  it('rejects malformed, unknown, fractional, mixed-currency and mismatched drafts', () => {
    for (const value of [
      null,
      [],
      {},
      { ...input, payee_ref: 42 },
      { ...input, cap: null },
      { ...input, cap: { minor: Number.MAX_SAFE_INTEGER + 1, currency: 'GBP' } },
      { ...input, cap: { minor: -1, currency: 'GBP' } },
      { ...input, cap: { minor: 999, currency: 'GBP' } },
      { ...input, window_days: 29 },
      { ...input, max_resubmits: 6 },
      { ...input, milestones: [] },
      { ...input, milestones: [null] },
      { ...input, milestones: [{ ...input.milestones[0], amount: { minor: 1000, currency: 'USD' } }] },
      { ...input, milestones: [{ ...input.milestones[0], params: [] }] },
      { ...input, milestones: [{ ...input.milestones[0], profile: 'unknown' }] },
      { ...input, milestones: [{ ...input.milestones[0], extra: true }] },
    ])
      expect(() => allowanceDraft(value)).toThrow();
  });
});
