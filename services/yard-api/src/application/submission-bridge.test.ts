import { expect, it, vi } from 'vitest';
import { confirmHold } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from './board.js';
import { SubmissionBridge } from './submission-bridge.js';

const now = 1791158400000,
  buyer = { id: 'buyer', root: 'buyer-root', kind: 'BUYER' as const },
  builder = { id: 'builder', root: 'builder-root', kind: 'BUILDER' as const };
async function fixture(store = new MemoryEvents()) {
  const board = new Board(store);
  const input = {
    id: 'p',
    buyerOperatorId: 'buyer',
    repository: 'buyer/project',
    baseCommit: 'a'.repeat(40),
    summary: 'Booking',
    createdAt: now,
    capMinor: 2000,
    currency: 'USD',
    milestones: ['one', 'two'].map((id, i) => ({
      id,
      name: id,
      budgetMinor: 1000,
      deadline: now + 86400000,
      profileId: i === 1 ? ('code.final@1' as const) : ('code.milestone@1' as const),
      testBundleHash: 'b'.repeat(64),
      manifestHash: 'c'.repeat(64),
      testIds: ['works'],
    })),
  };
  await board.create(input, buyer, 'create');
  await board.freeze(
    'p',
    {
      version: 1,
      buyerOperatorId: 'buyer',
      approvalReference: 'sim-approve',
      baselines: input.milestones.map((m) => ({
        milestoneId: m.id,
        testBundleHash: m.testBundleHash,
        manifestHash: m.manifestHash,
        failedTestIds: m.testIds,
        reference: 'sim-red',
      })),
    },
    buyer,
    1,
    'approve',
  );
  await board.post('p', 'one', 'tranche', buyer, 2, 'post', now);
  await board.claim('p', 'one', builder, 3, 'claim', now);
  await confirmHold(board, 'p', 'one', now);
  await board.build('p', 'one', builder, 5, 'build', now);
  return { board, store };
}
it('reserves an exact claim-bound request before HTTP and recovers a lost reply with the same key', async () => {
  const { board, store } = await fixture();
  const calls: unknown[] = [];
  const provider = {
    submit: async (input: {
      key: string;
      trancheId: string;
      repository: string;
      baseCommit: string;
      commit: string;
    }) => {
      expect((await board.view('p', 'one', builder)).state).toBe('SUBMITTING');
      calls.push(input);
      if (calls.length === 1) throw new Error('response lost after package created');
      return {
        id: 'package',
        trancheId: input.trancheId,
        repository: input.repository,
        baseCommit: input.baseCommit,
        commit: input.commit,
      };
    },
  };
  const first = new SubmissionBridge(board, provider);
  await expect(first.submit('p', 'one', 'd'.repeat(40), builder, 6, 'submit', now)).rejects.toThrow('response lost');
  const restored = new SubmissionBridge(new Board(store), provider);
  expect(await restored.recover(now + 1)).toEqual([{ projectId: 'p', wo: 'one', status: 'DELIVERED' }]);
  const result = await restored.submit('p', 'one', 'd'.repeat(40), builder, 6, 'submit', now + 1);
  expect(calls[0]).toEqual(calls[1]);
  expect(result.version).toBe(8);
  expect((await board.view('p', 'one', builder)).state).toBe('CHECKING');
  expect(await restored.submit('p', 'one', 'd'.repeat(40), builder, 6, 'submit', now + 2)).toEqual(result);
  expect(calls).toHaveLength(2);
  await expect(restored.submit('p', 'one', 'e'.repeat(40), builder, 6, 'submit', now)).rejects.toThrow('CONFLICT');
  await expect(
    restored.submit('p', 'one', 'd'.repeat(40), { ...builder, root: 'changed' }, 6, 'submit', now),
  ).rejects.toThrow('CONFLICT');
});
it('retains the reservation when a mismatched package receipt arrives', async () => {
  const { board } = await fixture();
  const submit = vi.fn(async () => ({
    id: 'wrong-package',
    trancheId: 'foreign',
    repository: 'buyer/project',
    baseCommit: 'a'.repeat(40),
    commit: 'd'.repeat(40),
  }));
  const bridge = new SubmissionBridge(board, { submit });
  await expect(bridge.submit('p', 'one', 'd'.repeat(40), builder, 6, 'submit', now)).rejects.toThrow('INVALID');
  expect((await board.view('p', 'one', builder)).state).toBe('SUBMITTING');
  await expect(bridge.submit('p', 'one', 'd'.repeat(40), builder, 6, 'different', now)).rejects.toThrow('CONFLICT');
  expect(submit).toHaveBeenCalledTimes(1);
});
