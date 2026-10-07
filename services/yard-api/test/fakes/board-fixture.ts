import { Board } from '../../src/application/board.js';
import type { YardEvents } from '../../src/ports/events.js';
import { MemoryEvents } from './events.js';
export const leaseAt = 1791158400000;
export const leaseBuyer = { id: 'buyer', root: 'buyer-root', kind: 'BUYER' as const };
export const leaseBuilder = { id: 'builder', root: 'builder-root', kind: 'BUILDER' as const };
export async function claimedFixture(store: YardEvents = new MemoryEvents(), id = 'lease-project') {
  // Fixture projects share one builder across many projects; the claim cap has its own tests.
  const board = new Board(store, { maxActiveClaims: 1000 });
  const input = {
    id,
    buyerOperatorId: leaseBuyer.id,
    repository: 'buyer/project',
    baseCommit: 'a'.repeat(40),
    summary: 'Booking',
    createdAt: leaseAt,
    capMinor: 2000,
    currency: 'USD',
    milestones: ['one', 'two'].map((id, i) => ({
      id,
      name: id,
      budgetMinor: 1000,
      deadline: leaseAt + 7 * 86400000,
      profileId: i === 1 ? ('code.final@1' as const) : ('code.milestone@1' as const),
      testBundleHash: 'b'.repeat(64),
      manifestHash: 'c'.repeat(64),
      testIds: ['works'],
    })),
  };
  await board.create(input, leaseBuyer, 'create');
  await board.freeze(
    id,
    {
      version: 1,
      buyerOperatorId: leaseBuyer.id,
      approvalReference: 'sim-approved',
      baselines: input.milestones.map((m) => ({
        milestoneId: m.id,
        testBundleHash: m.testBundleHash,
        manifestHash: m.manifestHash,
        failedTestIds: m.testIds,
        reference: 'sim-red',
      })),
    },
    leaseBuyer,
    1,
    'freeze',
  );
  await board.post(id, 'one', 'tranche', leaseBuyer, 2, 'post', leaseAt);
  await board.claim(id, 'one', leaseBuilder, 3, 'claim', leaseAt);
  await confirmHold(board, id, 'one', leaseAt);
  await board.build(id, 'one', leaseBuilder, 5, 'build', leaseAt);
  return { board, store, id };
}
// Stands in for Stood's verified hold notification for the work order's current attempt.
export async function confirmHold(board: Board, id: string, wo: string, at: number, days = 29) {
  const snapshot = await board.events.load(id);
  const order = (snapshot.data as { orders: Record<string, { trancheId: string }> }).orders[wo];
  if (!order) throw new Error('No such work order');
  return board.holdConfirmed(
    id,
    wo,
    {
      eventId: `hold-${id}-${wo}-${snapshot.version}`,
      trancheId: order.trancheId,
      effect: 'HOLD',
      expiresAt: at + days * 86400000,
      simulated: true,
    },
    snapshot.version,
  );
}
