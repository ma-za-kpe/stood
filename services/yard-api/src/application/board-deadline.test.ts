import { expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';

const deadline = leaseAt + 7 * 86400000;
it('hides elapsed offers and refuses a stale discovery card without writing', async () => {
  const { board, store, id } = await claimedFixture();
  await board.releaseClaim(id, 'one', leaseBuilder, 6, 'out', leaseAt);
  await board.repost(id, 'one', leaseBuyer, 7, 'repost', leaseAt);
  expect((await board.discoverPage('', deadline - 1)).orders).toHaveLength(1);
  expect((await board.discoverPage('', deadline)).orders).toHaveLength(0);
  const before = await store.load(id);
  await expect(board.claim(id, 'one', leaseBuilder, 8, 'late', deadline)).rejects.toThrow('CONFLICT');
  expect(await store.load(id)).toEqual(before);
});
it('rejects new posting and reposting at the deadline but permits lease cleanup', async () => {
  const { board, store, id } = await claimedFixture();
  const before = await store.load(id);
  await expect(board.post(id, 'two', 'final', leaseBuyer, 6, 'late-post', deadline)).rejects.toThrow('CONFLICT');
  expect(await store.load(id)).toEqual(before);
  await board.expireLease(id, 'one', leaseBuyer, 6, 'expire', deadline);
  await expect(board.repost(id, 'one', leaseBuyer, 7, 'late-repost', deadline)).rejects.toThrow('CONFLICT');
  expect((await board.view(id, 'one', leaseBuyer)).state).toBe('LEASE_EXPIRED');
});
it('rejects invalid discovery clocks instead of showing expired work', async () => {
  const { board } = await claimedFixture();
  for (const now of [NaN, Infinity, -1, 1.5]) await expect(board.discoverPage('', now)).rejects.toThrow('INVALID');
});
it('blocks new work at the deadline even when a late claim still has lease time', async () => {
  const { board, store, id } = await claimedFixture();
  await board.releaseClaim(id, 'one', leaseBuilder, 6, 'out', leaseAt);
  await board.repost(id, 'one', leaseBuyer, 7, 'repost', leaseAt);
  await board.claim(id, 'one', leaseBuilder, 8, 'last-minute', deadline - 1);
  await expect(board.build(id, 'one', leaseBuilder, 9, 'late-build', deadline)).rejects.toThrow('CONFLICT');
  await board.build(id, 'one', leaseBuilder, 9, 'new-build', deadline - 1);
  const before = await store.load(id);
  await expect(
    board.prepareSubmission(id, 'one', 'd'.repeat(40), leaseBuilder, 10, 'late-submit', deadline),
  ).rejects.toThrow('CONFLICT');
  await expect(
    board.submit(id, 'one', 'd'.repeat(40), 'package', leaseBuilder, 10, 'direct-late', deadline),
  ).rejects.toThrow('CONFLICT');
  expect(await store.load(id)).toEqual(before);
  const intent = await board.prepareSubmission(id, 'one', 'd'.repeat(40), leaseBuilder, 10, 'on-time', deadline - 1);
  // Historical receipt recovery is safe after the deadline: no new submission.
  expect(await board.prepareSubmission(id, 'one', 'd'.repeat(40), leaseBuilder, 10, 'on-time', deadline + 1)).toEqual(
    intent,
  );
  await board.completeSubmission(id, 'one', intent, 'provider-package');
  expect((await board.view(id, 'one', leaseBuyer)).state).toBe('CHECKING');
});
