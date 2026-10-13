import { expect, it } from 'vitest';
import type { StoredDraft } from '../ports/platform-api-store.js';
import { allowanceAmendment } from './allowance-amendment.js';

const current: StoredDraft = {
  id: 'allowance',
  status: 'DRAFT',
  payee_ref: 'merchant',
  cap: { minor: 100, currency: 'USD' },
  window_days: 7,
  max_resubmits: 1,
  milestones: [
    {
      name: 'stage',
      amount: { minor: 100, currency: 'USD' },
      profile: 'construction.stage@1',
      params: { stage: 'foundation' },
    },
  ],
  tranches: [{ id: 'tranche', name: 'stage' }],
};
const input = (changes: Record<string, unknown> = {}) => ({
  payee_ref: current.payee_ref,
  cap: current.cap,
  milestones: [{ ...current.milestones[0], params: { stage: 'roofing' } }],
  window_days: 7,
  max_resubmits: 1,
  ...changes,
});
it('proposes new evidence terms without changing or mutating the signed snapshot', () => {
  const result = allowanceAmendment(current, input(), new Set());
  expect(result.milestones[0]?.params).toEqual({ stage: 'roofing' });
  expect(current.milestones[0]?.params).toEqual({ stage: 'foundation' });
  expect(result.tranches).toEqual(current.tranches);
  expect(result.id).toBe(current.id);
});
it('rejects financial changes, no-ops and any change to a milestone with reserved funding', () => {
  for (const changed of [
    { payee_ref: 'other' },
    { cap: { minor: 200, currency: 'USD' } },
    { window_days: 8 },
    { max_resubmits: 2 },
    { milestones: [{ ...current.milestones[0], name: 'other', params: { stage: 'roofing' } }] },
  ])
    expect(() => allowanceAmendment(current, input(changed), new Set())).toThrow();
  expect(() => allowanceAmendment(current, input({ milestones: current.milestones }), new Set())).toThrow();
  expect(() => allowanceAmendment(current, input(), new Set(['tranche']))).toThrow();
});
it('preserves funded terms while changing only another unfunded milestone', () => {
  const prior: StoredDraft = {
    ...current,
    cap: { minor: 200, currency: 'USD' },
    milestones: [current.milestones[0]!, { ...current.milestones[0]!, name: 'next' }],
    tranches: [...current.tranches, { id: 'next-tranche', name: 'next' }],
  };
  const value = {
    ...input(),
    cap: prior.cap,
    milestones: [prior.milestones[0], { ...prior.milestones[1], params: { stage: 'roofing' } }],
  };
  expect(allowanceAmendment(prior, value, new Set(['tranche'])).milestones[0]).toEqual(prior.milestones[0]);
  expect(() => allowanceAmendment(prior, value, new Set(['next-tranche']))).toThrow('funded work');
});
