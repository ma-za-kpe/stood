import { expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import type { StoodProof } from './board.js';
import { StoodWatch } from './stood-watch.js';

// T-0189: Stood sends platforms no notifications, so Yard reads every tranche it is waiting on and applies what the
// fresh read shows. Reads are idempotent: the same Stood state never produces a second event.
it('applies holds and captures from fresh Stood reads, waits on everything else and never repeats itself', async () => {
  const { board, id } = await claimedFixture();
  const v = async () => (await board.events.load(id)).version;
  await board.submit(id, 'one', 'd'.repeat(40), 'pkg_1', leaseBuilder, await v(), 'submit', leaseAt);
  await board.post(id, 'two', 'tranche-2', leaseBuyer, await v(), 'post-2', leaseAt);
  await board.claim(id, 'two', leaseBuilder, await v(), 'claim-2', leaseAt);
  expect((await board.awaitingStood()).items).toEqual([
    { projectId: id, wo: 'one', trancheId: 'tranche', waitingFor: 'DECISION', packageId: 'pkg_1' },
    { projectId: id, wo: 'two', trancheId: 'tranche-2', waitingFor: 'HOLD' },
  ]);
  const proofs = new Map<string, StoodProof | null | Error>([
    ['tranche', null],
    ['tranche-2', new Error('Stood unavailable')],
  ]);
  const watch = new StoodWatch(board, {
    read: async (trancheId) => {
      const p = proofs.get(trancheId);
      if (p instanceof Error) throw p;
      return p ?? null;
    },
  });
  const before = await v();
  expect(await watch.run()).toEqual({ applied: 0, waiting: 2 });
  expect(await v()).toBe(before);
  proofs.set('tranche', {
    trancheId: 'tranche',
    packageId: 'pkg_1',
    reference: 'cap_1',
    effect: 'CAPTURE',
    minor: 1000,
    currency: 'USD',
    simulated: true,
  });
  proofs.set('tranche-2', {
    trancheId: 'tranche-2',
    effect: 'HOLD',
    expiresAt: leaseAt + 29 * 86400000,
    simulated: true,
  });
  expect(await watch.run()).toEqual({ applied: 2, waiting: 0 });
  const after = await board.events.load(id);
  const orders = (after.data as { orders: Record<string, { payment?: { reference: string }; holds?: unknown[] }> })
    .orders;
  expect(orders.one?.payment?.reference).toBe('cap_1');
  expect(orders.two?.holds).toHaveLength(1);
  expect((await board.awaitingStood()).items).toEqual([]);
  expect(await watch.run()).toEqual({ applied: 0, waiting: 0 });
  expect(await v()).toBe(after.version);
  // A proof that does not match what Yard is waiting for is never applied.
  await board.build(id, 'two', leaseBuilder, await v(), 'build-2', leaseAt);
  await board.submit(id, 'two', 'e'.repeat(40), 'pkg_2', leaseBuilder, await v(), 'submit-2', leaseAt);
  proofs.set('tranche-2', {
    ...(proofs.get('tranche') as StoodProof),
    trancheId: 'tranche-2',
    packageId: 'pkg_other',
  } as StoodProof);
  expect(await watch.run()).toEqual({ applied: 0, waiting: 1 });
});
