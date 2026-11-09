import { expect, it } from 'vitest';
import { type Data, DEMO_MAX_CAP_MINOR, HOLDBACK_MS, payoutDueAt } from './board-state.js';

const data = (capMinor: number, demo: boolean) =>
  ({
    blueprint: { capMinor, milestones: [{ id: 'one', profileId: 'code.milestone@1' }] },
    orders: {},
    ...(demo ? { demo: { runId: 'r', immediatePayout: true } } : {}),
  }) as unknown as Data;
const paid = { milestone: 'one', payment: { minor: 100 }, releasedAt: 1000 } as never;

it('pays a small demo project at release and keeps the 48-hour holdback for every other project', () => {
  expect(payoutDueAt(data(300, true), paid)).toBe(1000);
  expect(payoutDueAt(data(300, false), paid)).toBe(1000 + HOLDBACK_MS);
  expect(payoutDueAt(data(DEMO_MAX_CAP_MINOR + 1, true), paid)).toBe(1000 + HOLDBACK_MS);
});
it('still holds a disputed demo payout until the owner decides', () => {
  expect(payoutDueAt(data(300, true), { ...(paid as object), dispute: { openedAt: 1 } } as never)).toBeNull();
});
