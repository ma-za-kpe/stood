import { type CostLine, costDisclosure } from '@stood/yard-domain';

export type CostRow = Readonly<{ label: string; detail: string; amount: string }>;
// ADR-0019 disclosure: builder budgets, the Yard fee (even at $0) and every other cost, each once,
// with who receives it, who pays and whether it is an estimate limit or a recurring charge.
export function costRows(
  blueprint: Readonly<{
    capMinor: number;
    currency: string;
    milestones: readonly { budgetMinor: number }[];
    costLines?: readonly CostLine[] | undefined;
  }>,
): { rows: CostRow[]; total: string } | null {
  let disclosed: ReturnType<typeof costDisclosure>;
  try {
    disclosed = costDisclosure(blueprint, blueprint.costLines);
  } catch {
    return null;
  }
  const money = (minor: number) =>
    new Intl.NumberFormat('en', { style: 'currency', currency: disclosed.currency }).format(minor / 100);
  return {
    rows: [
      {
        label: 'Builder milestones',
        detail: 'Paid by you through Stood, per milestone',
        amount: money(disclosed.buildersMinor),
      },
      ...disclosed.lines.map((l) => ({
        label: l.label,
        detail: [
          `To ${l.recipient}`,
          l.payer === 'YARD' ? 'paid by Yard, not you' : 'paid by you',
          ...(l.estimate ? ['estimate, at most this'] : []),
          ...(l.billing === 'MONTHLY' ? ['per month'] : []),
        ].join(' · '),
        amount: money(l.minor),
      })),
    ],
    total: `${money(disclosed.buyerTotalMinor)} of your ${money(disclosed.capMinor)} approved cap`,
  };
}
