// ADR-0019: Yard's platform fee and any preview or provider cost are separate,
// named line items, disclosed before signing. Charging is not enabled, so the
// pilot fee is fixed at zero and shown as such.
export const PILOT_PLATFORM_FEE_MINOR = 0;
export type CostLine = Readonly<{
  id: string;
  kind: 'YARD_PLATFORM_FEE' | 'PREVIEW_HOSTING' | 'PROVIDER';
  label: string;
  recipient: string;
  payer: 'BUYER' | 'YARD';
  minor: number;
  basis: 'FIXED' | 'ESTIMATE_LIMIT';
  billing: 'ONE_OFF' | 'MONTHLY';
}>;
export const pilotFee: CostLine = Object.freeze({
  id: 'yard-fee',
  kind: 'YARD_PLATFORM_FEE',
  label: 'Yard platform fee (free pilot)',
  recipient: 'Yard',
  payer: 'BUYER',
  minor: PILOT_PLATFORM_FEE_MINOR,
  basis: 'FIXED',
  billing: 'ONE_OFF',
});
export type CostDisclosure = Readonly<{
  currency: string;
  lines: readonly Readonly<{
    label: string;
    recipient: string;
    payer: CostLine['payer'];
    minor: number;
    estimate: boolean;
    billing: CostLine['billing'];
  }>[];
  buildersMinor: number;
  buyerTotalMinor: number;
  capMinor: number;
}>;
const text = (s: unknown) => typeof s === 'string' && s.trim().length > 0 && s.length <= 200;

export function checkedCostLines(lines: readonly CostLine[] | undefined): readonly CostLine[] {
  const all = lines ?? [pilotFee];
  if (!Array.isArray(all) || all.length > 20) throw new RangeError('Invalid cost lines');
  const checked = all.map((l) => {
    if (
      !l ||
      typeof l !== 'object' ||
      !text(l.id) ||
      !text(l.label) ||
      !text(l.recipient) ||
      !['YARD_PLATFORM_FEE', 'PREVIEW_HOSTING', 'PROVIDER'].includes(l.kind) ||
      !['BUYER', 'YARD'].includes(l.payer) ||
      !['FIXED', 'ESTIMATE_LIMIT'].includes(l.basis) ||
      !['ONE_OFF', 'MONTHLY'].includes(l.billing) ||
      !Number.isSafeInteger(l.minor) ||
      l.minor < 0
    )
      throw new RangeError('Invalid cost line');
    return Object.freeze({ ...l });
  });
  const fees = checked.filter((l) => l.kind === 'YARD_PLATFORM_FEE');
  // Exactly one Yard fee line, paid by the buyer, at the pilot rate: never hidden, never doubled.
  if (
    fees.length !== 1 ||
    fees[0]?.payer !== 'BUYER' ||
    fees[0].minor !== PILOT_PLATFORM_FEE_MINOR ||
    fees[0].billing !== 'ONE_OFF' ||
    new Set(checked.map((l) => l.id)).size !== checked.length
  )
    throw new RangeError('Invalid platform fee');
  return Object.freeze(checked);
}

// Builder budgets plus every buyer-paid line (estimates at their limit) must equal the approved cap.
// Recurring lines count one period; the label and billing say so before signing.
export function costDisclosure(
  terms: Readonly<{ capMinor: number; currency: string; milestones: readonly { budgetMinor: number }[] }>,
  lines: readonly CostLine[] | undefined,
): CostDisclosure {
  const checked = checkedCostLines(lines);
  const builders = terms.milestones.reduce((n, m) => n + BigInt(m.budgetMinor), 0n);
  const buyer = checked.filter((l) => l.payer === 'BUYER').reduce((n, l) => n + BigInt(l.minor), builders);
  if (buyer !== BigInt(terms.capMinor)) throw new RangeError('Invalid milestone total or identity');
  return Object.freeze({
    currency: terms.currency,
    lines: Object.freeze(
      checked.map((l) =>
        Object.freeze({
          label: l.label,
          recipient: l.recipient,
          payer: l.payer,
          minor: l.minor,
          estimate: l.basis === 'ESTIMATE_LIMIT',
          billing: l.billing,
        }),
      ),
    ),
    buildersMinor: Number(builders),
    buyerTotalMinor: Number(buyer),
    capMinor: terms.capMinor,
  });
}
