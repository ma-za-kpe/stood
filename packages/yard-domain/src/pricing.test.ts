import { expect, it } from 'vitest';
import { Blueprint, type BlueprintInput } from './blueprint.js';
import { type CostLine, checkedCostLines, costDisclosure, pilotFee } from './pricing.js';

const at = 1790985600000;
const milestone = (id: string, profileId: 'code.milestone@1' | 'code.final@1', budgetMinor = 60000) => ({
  id,
  name: id,
  budgetMinor,
  deadline: at + 86400000,
  profileId,
  testBundleHash: 'a'.repeat(64),
  manifestHash: 'b'.repeat(64),
  testIds: ['accept_booking'],
});
const input: BlueprintInput = {
  id: 'bp_1',
  buyerOperatorId: 'buyer_1',
  repository: 'adaeze/bookings',
  baseCommit: 'c'.repeat(40),
  summary: 'Book a slot',
  createdAt: at,
  capMinor: 120000,
  currency: 'USD',
  milestones: [milestone('m1', 'code.milestone@1'), milestone('m2', 'code.final@1')],
};
const preview: CostLine = {
  id: 'preview',
  kind: 'PREVIEW_HOSTING',
  label: 'Preview hosting, up to one month',
  recipient: 'Render',
  payer: 'BUYER',
  minor: 700,
  basis: 'ESTIMATE_LIMIT',
  billing: 'MONTHLY',
};

it('shows the $0 pilot fee explicitly when the blueprint names no cost lines (T-0216)', () => {
  const bp = Blueprint.create(input);
  expect(bp.snapshot.costLines).toEqual([pilotFee]);
  expect(costDisclosure(bp.snapshot, bp.snapshot.costLines)).toEqual({
    currency: 'USD',
    lines: [
      {
        label: 'Yard platform fee (free pilot)',
        recipient: 'Yard',
        payer: 'BUYER',
        minor: 0,
        estimate: false,
        billing: 'ONE_OFF',
      },
    ],
    buildersMinor: 120000,
    buyerTotalMinor: 120000,
    capMinor: 120000,
  });
  // An older stored snapshot without cost lines discloses the same default.
  expect(costDisclosure(input, undefined).lines).toHaveLength(1);
});

it('keeps builder budgets whole and counts buyer-paid costs at their limit within the cap', () => {
  const costLines = [pilotFee, preview, { ...preview, id: 'yard-preview', payer: 'YARD' as const, minor: 500 }];
  const bp = Blueprint.create({ ...input, capMinor: 120700, costLines });
  const disclosed = costDisclosure(bp.snapshot, bp.snapshot.costLines);
  expect(disclosed).toMatchObject({ buildersMinor: 120000, buyerTotalMinor: 120700 });
  expect(disclosed.lines.map((l) => [l.recipient, l.payer, l.estimate, l.billing])).toEqual([
    ['Yard', 'BUYER', false, 'ONE_OFF'],
    ['Render', 'BUYER', true, 'MONTHLY'],
    ['Render', 'YARD', true, 'MONTHLY'],
  ]);
  // A cost may not quietly reduce a builder's milestone: the buyer total must equal the cap exactly.
  expect(() => Blueprint.create({ ...input, costLines })).toThrow('total');
  expect(() => Blueprint.create({ ...input, capMinor: 121000, costLines })).toThrow('total');
  // Signed prices stay with the snapshot through edits.
  expect(bp.edit(1, { ...bp.snapshot, summary: 'Revised' }).snapshot.costLines).toEqual(bp.snapshot.costLines);
});

it('refuses hidden, doubled, charged or malformed fee lines', () => {
  for (const lines of [
    [],
    [preview],
    [pilotFee, pilotFee],
    [pilotFee, { ...pilotFee, id: 'second-fee' }],
    [{ ...pilotFee, minor: 100 }],
    [{ ...pilotFee, payer: 'YARD' }],
    [{ ...pilotFee, billing: 'MONTHLY' }],
    [pilotFee, { ...preview, id: 'yard-fee' }],
  ])
    expect(() => checkedCostLines(lines as CostLine[]), JSON.stringify(lines)).toThrow('fee');
  for (const line of [
    null,
    'fee',
    { ...preview, id: '' },
    { ...preview, label: ' ' },
    { ...preview, recipient: 'x'.repeat(201) },
    { ...preview, kind: 'TIP' },
    { ...preview, payer: 'BUILDER' },
    { ...preview, basis: 'GUESS' },
    { ...preview, billing: 'WEEKLY' },
    { ...preview, minor: -1 },
    { ...preview, minor: 1.5 },
  ])
    expect(() => checkedCostLines([pilotFee, line] as CostLine[])).toThrow('cost line');
  expect(() => checkedCostLines({} as never)).toThrow('cost lines');
  expect(() => checkedCostLines(Array.from({ length: 21 }, () => pilotFee))).toThrow('cost lines');
});
