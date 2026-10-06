import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { createYardApp } from '../http/app.js';
import { Board, MAX_ACTIVE_CLAIMS } from './board.js';

async function posted(board: Board, id: string) {
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
  await board.post(id, 'one', `tranche-${id}`, leaseBuyer, 2, 'post', leaseAt);
}

it('caps active claims per builder operator root across projects; replays and clock-outs behave (T-0209)', async () => {
  expect(MAX_ACTIVE_CLAIMS).toBe(2);
  const board = new Board(new MemoryEvents());
  for (const id of ['p1', 'p2', 'p3']) await posted(board, id);
  await board.claim('p1', 'one', leaseBuilder, 3, 'c1', leaseAt);
  await board.claim('p2', 'one', leaseBuilder, 3, 'c2', leaseAt);
  expect(await board.activeClaims(leaseBuilder.root, leaseAt)).toBe(2);
  await expect(board.claim('p3', 'one', leaseBuilder, 3, 'c3', leaseAt)).rejects.toThrow('CONFLICT');
  // Another operator root is unaffected, and an exact replay still succeeds at the cap.
  await board.claim('p3', 'one', { id: 'crew-2', root: 'crew-2-root', kind: 'BUILDER' }, 3, 'other', leaseAt);
  expect((await board.claim('p2', 'one', leaseBuilder, 3, 'c2', leaseAt)).version).toBe(4);
  // Clocking out frees a slot; an expired lease does not count.
  await board.releaseClaim('p1', 'one', leaseBuilder, 4, 'out', leaseAt + 1);
  expect(await board.activeClaims(leaseBuilder.root, leaseAt + 1)).toBe(1);
  expect(await board.activeClaims(leaseBuilder.root, leaseAt + 49 * 3600000)).toBe(0);
});

it('rotates operator keys with notAfter and refuses credential-shaped payee references (T-0209)', async () => {
  const board = new Board(new MemoryEvents());
  const config = (operators: unknown[]) =>
    createYardApp({ environment: 'ci', board: { board, clock: async () => leaseAt, operators: operators as never } });
  const builder = { id: 'crew', root: 'crew-root', kind: 'BUILDER' };
  expect(() => config([{ key: 'k', secret: 's', actor: builder, payeeRef: 'sk_live_aaaaaaaaaaaaaaaa' }])).toThrow();
  expect(() => config([{ key: 'k', secret: 's', actor: builder, payeeRef: 'not an email' }])).toThrow();
  expect(() => config([{ key: 'k', secret: 's', actor: builder, notAfter: -1 }])).toThrow();
  const app = config([
    { key: 'old', secret: 'old-secret', actor: builder, payeeRef: 'crew-operator@example.com', notAfter: leaseAt },
    { key: 'new', secret: 'new-secret', actor: builder, payeeRef: 'ABCDEFGHJKLMN' },
  ]);
  const get = (key: string, secret: string) => {
    const t = String(leaseAt / 1000);
    return app.request('/yard/v1/board', {
      headers: {
        'Yard-Key-Id': key,
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', secret)
          .update(JSON.stringify(['yard.request@2', t, key, 'GET', '/yard/v1/board', '', '', '', '', '']))
          .digest('hex')}`,
      },
    });
  };
  // The retired key stops at its notAfter instant; the new key keeps working.
  expect((await get('old', 'old-secret')).status).toBe(401);
  expect((await get('new', 'new-secret')).status).toBe(200);
});
