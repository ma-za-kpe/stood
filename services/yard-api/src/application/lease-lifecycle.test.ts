import { LEASE_MS } from '@stood/yard-domain';
import { expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';

it('expires at the boundary and reposts durable work without retaining the old builder scope', async () => {
  const { board, store, id } = await claimedFixture();
  const end = leaseAt + LEASE_MS;
  await expect(board.expireLease(id, 'one', leaseBuyer, 6, 'early', end - 1)).rejects.toThrow('CONFLICT');
  expect((await board.view(id, 'one', leaseBuyer)).state).toBe('BUILDING');
  const expired = await board.expireLease(id, 'one', leaseBuyer, 6, 'expire', end);
  expect((await board.view(id, 'one', leaseBuyer)).state).toBe('LEASE_EXPIRED');
  await expect(board.read(id, leaseBuilder)).rejects.toThrow('FORBIDDEN');
  expect((await board.discover(leaseAt)).filter((o) => o.projectId === id)).toHaveLength(0);
  await board.repost(id, 'one', leaseBuyer, 7, 'repost', end);
  expect(await board.expireLease(id, 'one', leaseBuyer, 6, 'expire', end + 1)).toEqual(expired);
  expect((await board.discover(leaseAt)).filter((o) => o.projectId === id)).toHaveLength(1);
  await expect(board.submit(id, 'one', 'd'.repeat(40), 'old', leaseBuilder, 8, 'old-submit', end)).rejects.toThrow();
  const next = { id: 'next', root: 'next-root', kind: 'BUILDER' as const };
  await board.claim(id, 'one', next, 8, 'next-claim', end);
  expect((await board.view(id, 'one', next)).currentClaim?.builderId).toBe('next');
  expect((await store.read(id, 0)).map((e) => e.type).slice(-3)).toEqual([
    'wo.lease_expired',
    'wo.reposted',
    'wo.claimed',
  ]);
  expect((await board.view(id, 'one', leaseBuyer)).payment).toBeNull();
});
it('does not abandon an unresolved submission when its lease time passes', async () => {
  const { board, id } = await claimedFixture();
  await board.prepareSubmission(id, 'one', 'd'.repeat(40), leaseBuilder, 6, 'submit', leaseAt);
  for (const [method, actor] of [
    ['expireLease', leaseBuyer],
    ['releaseClaim', leaseBuilder],
    ['repost', leaseBuyer],
  ] as const) {
    await expect(board[method](id, 'one', actor, 6, method, leaseAt + LEASE_MS)).rejects.toThrow();
  }
  expect((await board.view(id, 'one', leaseBuyer)).state).toBe('SUBMITTING');
});
it('authorises clock-out to the current builder and expiry/repost to the owning buyer', async () => {
  const { board, id } = await claimedFixture();
  await expect(board.expireLease(id, 'one', leaseBuilder, 6, 'wrong-owner', leaseAt + LEASE_MS)).rejects.toThrow(
    'FORBIDDEN',
  );
  await expect(board.repost(id, 'one', leaseBuilder, 6, 'wrong-repost', leaseAt)).rejects.toThrow('FORBIDDEN');
  await expect(board.releaseClaim(id, 'one', leaseBuyer, 6, 'wrong-builder', leaseAt)).rejects.toThrow('FORBIDDEN');
  await board.releaseClaim(id, 'one', leaseBuilder, 6, 'clock-out', leaseAt);
  expect((await board.view(id, 'one', leaseBuyer)).state).toBe('ABANDONED');
  await board.repost(id, 'one', leaseBuyer, 7, 'repost', leaseAt);
  expect((await board.view(id, 'one', leaseBuyer)).state).toBe('POSTED');
});
it('keeps discovery identities distinct when projects use the same milestone name', async () => {
  const { store, board } = await claimedFixture(undefined, 'alpha');
  await claimedFixture(store, 'beta');
  for (const id of ['alpha', 'beta']) {
    await board.releaseClaim(id, 'one', leaseBuilder, 6, 'out', leaseAt);
    await board.repost(id, 'one', leaseBuyer, 7, 'repost', leaseAt);
  }
  const offers = await board.discover(leaseAt);
  expect(offers).toHaveLength(2);
  expect(new Set(offers.map((o) => o.id)).size).toBe(2);
  expect(offers.map((o) => o.workOrderId)).toEqual(['one', 'one']);
});

it('uses the same byte ordering for discovery cursors in the in-memory provider', async () => {
  const { store, board } = await claimedFixture(undefined, 'Z-project');
  await claimedFixture(store, 'a-project');
  await claimedFixture(store, 'A-project');
  expect((await store.list()).map((p) => p.id)).toEqual(['A-project', 'Z-project', 'a-project']);
  expect((await store.list('Z-project')).map((p) => p.id)).toEqual(['a-project']);
  expect(await board.discoverPage('Z-project', leaseAt)).toMatchObject({ orders: [], nextCursor: null });
});
