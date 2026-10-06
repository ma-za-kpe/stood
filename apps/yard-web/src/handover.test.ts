import { BUYER_HANDOVER_ITEMS } from '@stood/yard-contracts';
import { expect, it } from 'vitest';
import { closeBlocker } from './handover.js';
import { roomChecked } from './project-state.js';

const order = (state: string) => ({
  id: state.toLowerCase(),
  name: 'm',
  state,
  budgetMinor: 1000,
  trancheId: 't',
  payment:
    state === 'PAID'
      ? {
          trancheId: 't',
          packageId: 'p',
          reference: 'r',
          effect: 'CAPTURE',
          minor: 1000,
          currency: 'USD',
          simulated: true,
        }
      : null,
  submission: state === 'PAID' ? { packageId: 'p', commit: 'a'.repeat(40) } : null,
  leasedUntil: null,
});
const room = (states: string[], handover: unknown = null) =>
  roomChecked({
    id: 'p',
    version: 9,
    summary: 's',
    currency: 'USD',
    simulated: true,
    handover,
    orders: states.map((s, i) => ({ ...order(s), id: `o${i}` })),
  });
it('blocks closing until every milestone is paid and every buyer item is ticked (T-0207)', () => {
  const all = new Set(BUYER_HANDOVER_ITEMS);
  expect(closeBlocker(room(['PAID', 'CHECKING']), all)).toBe('UNPAID');
  expect(closeBlocker(room([]), all)).toBe('UNPAID');
  expect(closeBlocker(room(['PAID', 'PAID']), new Set(BUYER_HANDOVER_ITEMS.slice(1)))).toBe('UNCHECKED');
  expect(closeBlocker(room(['PAID', 'PAID']), all)).toBeNull();
  const closed = room(['PAID'], { status: 'CLOSED', closedAt: 1, confirmed: [...BUYER_HANDOVER_ITEMS].sort() });
  expect(closeBlocker(closed, all)).toBe('CLOSED');
});
it('rejects malformed handover records in snapshots', () => {
  for (const bad of [
    { status: 'OPEN', closedAt: 1, confirmed: [] },
    { status: 'CLOSED', closedAt: -1, confirmed: [...BUYER_HANDOVER_ITEMS] },
    { status: 'CLOSED', closedAt: 1, confirmed: ['made-up'] },
  ])
    expect(() => room(['PAID'], bad)).toThrow();
});
