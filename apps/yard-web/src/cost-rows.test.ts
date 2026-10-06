import { pilotFee } from '@stood/yard-domain';
import { expect, it } from 'vitest';
import { costRows } from './cost-rows.js';

const blueprint = { capMinor: 120000, currency: 'USD', milestones: [{ budgetMinor: 60000 }, { budgetMinor: 60000 }] };

it('names the $0 Yard fee and every cost once, with recipient and payer (T-0216)', () => {
  expect(costRows(blueprint)).toEqual({
    rows: [
      { label: 'Builder milestones', detail: 'Paid by you through Stood, per milestone', amount: '$1,200.00' },
      { label: 'Yard platform fee (free pilot)', detail: 'To Yard · paid by you', amount: '$0.00' },
    ],
    total: '$1,200.00 of your $1,200.00 approved cap',
  });
  const preview = {
    id: 'preview',
    kind: 'PREVIEW_HOSTING' as const,
    label: 'Preview hosting',
    recipient: 'Render',
    payer: 'YARD' as const,
    minor: 700,
    basis: 'ESTIMATE_LIMIT' as const,
    billing: 'MONTHLY' as const,
  };
  expect(costRows({ ...blueprint, costLines: [pilotFee, preview] })?.rows[2]).toEqual({
    label: 'Preview hosting',
    detail: 'To Render · paid by Yard, not you · estimate, at most this · per month',
    amount: '$7.00',
  });
  // Terms that do not add up are never shown as a signable breakdown.
  expect(costRows({ ...blueprint, capMinor: 1 })).toBeNull();
});
