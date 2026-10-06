import { expect, it } from 'vitest';
import { confirmHold, leaseAt, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from './board.js';

const outside = { id: 'crew', root: 'crew-root', kind: 'BUILDER' as const };
const inside = { id: 'buyer-crew', root: 'buyer-root', kind: 'BUILDER' as const };
async function paidProject(board: Board, id: string, builder: typeof outside, refuseFirst = false) {
  const milestones = ['one', 'two'].map((m, i) => ({
    id: m,
    name: m,
    budgetMinor: 1000,
    deadline: leaseAt + 7 * 86400000,
    profileId: (i ? 'code.final@1' : 'code.milestone@1') as 'code.final@1' | 'code.milestone@1',
    testBundleHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    testIds: ['works'],
  }));
  await board.create(
    {
      id,
      buyerOperatorId: 'buyer',
      repository: 'buyer/project',
      baseCommit: 'a'.repeat(40),
      summary: 'Booking',
      createdAt: leaseAt,
      capMinor: 2000,
      currency: 'USD',
      milestones,
    },
    leaseBuyer,
    'create',
  );
  await board.freeze(
    id,
    {
      version: 1,
      buyerOperatorId: 'buyer',
      approvalReference: 'sim',
      baselines: milestones.map((m) => ({
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
  const v = async () => (await board.events.load(id)).version;
  await board.post(id, 'one', `t-${id}`, leaseBuyer, 2, 'post', leaseAt);
  await board.claim(id, 'one', builder, 3, 'claim', leaseAt);
  let pkg = `${id}-pkg-1`;
  await confirmHold(board, id, 'one', leaseAt);
  await board.build(id, 'one', builder, await v(), 'build', leaseAt);
  await board.submit(id, 'one', 'd'.repeat(40), pkg, builder, await v(), 'submit', leaseAt);
  if (refuseFirst) {
    await board.refusal(
      id,
      'one',
      {
        eventId: `${id}-refused`,
        trancheId: `t-${id}`,
        packageId: pkg,
        reference: 'void',
        effect: 'VOID',
        punchList: [{ field: 'weak_tests', reason: 'Weak tests.' }],
        resubmissionsLeft: 1,
        simulated: true,
      },
      await v(),
    );
    await confirmHold(board, id, 'one', leaseAt);
    await board.build(id, 'one', builder, await v(), 'rebuild', leaseAt);
    pkg = `${id}-pkg-2`;
    await board.submit(id, 'one', 'e'.repeat(40), pkg, builder, await v(), 'submit-2', leaseAt);
  }
  await board.settlement(
    id,
    'one',
    {
      eventId: `${id}-paid`,
      trancheId: `t-${id}`,
      packageId: pkg,
      reference: 'capture',
      effect: 'CAPTURE',
      minor: 1000,
      currency: 'USD',
      simulated: true,
    },
    await v(),
  );
}

it('counts reputation only from outside buyers and reports self-dealing and refusals separately (T-0190)', async () => {
  const board = new Board(new MemoryEvents(), { maxActiveClaims: 100 });
  await paidProject(board, 'a', outside);
  await paidProject(board, 'b', outside, true);
  await paidProject(board, 'c', inside);
  expect(await board.reputation('crew-root')).toEqual({ root: 'crew-root', counted: 2, selfDealing: 0, refusals: 1 });
  // The buyer's own operator tree earns nothing from paying itself (Y13 anti-pyramid rule).
  expect(await board.reputation('buyer-root')).toEqual({ root: 'buyer-root', counted: 0, selfDealing: 1, refusals: 0 });
  expect(await board.reputation('nobody')).toEqual({ root: 'nobody', counted: 0, selfDealing: 0, refusals: 0 });
});

it('records buyer usage of the final milestone only, once, and never from a builder (T-0190)', async () => {
  const board = new Board(new MemoryEvents(), { maxActiveClaims: 100 });
  await paidProject(board, 'u', outside);
  const v = async () => (await board.events.load('u')).version;
  await board.post('u', 'two', 't-u-2', leaseBuyer, await v(), 'post-2', leaseAt);
  await expect(board.confirmUsage('u', outside, await v(), 'self', leaseAt, 'two')).rejects.toThrow('FORBIDDEN');
  await expect(board.confirmUsage('u', leaseBuyer, await v(), 'wrong', leaseAt, 'one')).rejects.toThrow('INVALID');
  await board.confirmUsage('u', leaseBuyer, await v(), 'used', leaseAt + 5, 'two');
  await expect(board.confirmUsage('u', leaseBuyer, await v(), 'again', leaseAt + 6, 'two')).rejects.toThrow('CONFLICT');
  expect((await board.view('u', 'two', leaseBuyer)).usage).toEqual({ confirmedAt: leaseAt + 5 });
  expect((await board.events.read('u', 0)).at(-1)).toMatchObject({ type: 'usage.confirmed', actor: 'buyer' });
});
