import { afterAll, beforeAll, expect, it } from 'vitest';
import { yardDatabase } from '../../../test/database.js';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../../test/fakes/board-fixture.js';
import { Board } from '../../application/board.js';
import { SubmissionBridge } from '../../application/submission-bridge.js';
import { migrateYardEvents, PostgresYardEvents } from './events.js';

let f: Awaited<ReturnType<typeof yardDatabase>>;
let board: Board;
const at = 1791158400000;
const buyer = { id: 'buyer', root: 'buyer-root', kind: 'BUYER' as const };
const builder = { id: 'builder', root: 'crew-root', kind: 'BUILDER' as const };
const other = { id: 'other', root: 'other-root', kind: 'BUILDER' as const };
const input = {
  id: 'bp',
  buyerOperatorId: 'buyer',
  repository: 'buyer/project',
  baseCommit: 'a'.repeat(40),
  summary: 'Booking app',
  createdAt: at,
  capMinor: 2000,
  currency: 'USD',
  milestones: [
    {
      id: 'one',
      name: 'Build',
      budgetMinor: 1000,
      deadline: at + 86400000,
      profileId: 'code.milestone@1' as const,
      testBundleHash: 'b'.repeat(64),
      manifestHash: 'c'.repeat(64),
      testIds: ['works'],
    },
    {
      id: 'two',
      name: 'Use',
      budgetMinor: 1000,
      deadline: at + 86400000,
      profileId: 'code.final@1' as const,
      testBundleHash: 'b'.repeat(64),
      manifestHash: 'c'.repeat(64),
      testIds: ['works'],
    },
  ],
};
beforeAll(async () => {
  f = await yardDatabase();
  await migrateYardEvents(f.pool, f.owner);
  board = new Board(new PostgresYardEvents(f.limited));
});
afterAll(async () => {
  if (f) await f.close();
});
it('keeps expired work unclaimable after a database reconnect without adding an event', async () => {
  const events = new PostgresYardEvents(f.limited);
  const { board: initial, id } = await claimedFixture(events, 'deadline-project');
  await initial.releaseClaim(id, 'one', leaseBuilder, 5, 'out', leaseAt);
  await initial.repost(id, 'one', leaseBuyer, 6, 'repost', leaseAt);
  const connection = f.connectRuntime();
  try {
    const restored = new Board(new PostgresYardEvents(connection));
    const deadline = leaseAt + 7 * 86400000;
    const before = await events.read(id, 0);
    expect((await restored.discoverPage('', deadline)).orders.filter((o) => o.projectId === id)).toHaveLength(0);
    await expect(restored.claim(id, 'one', leaseBuilder, 7, 'late', deadline)).rejects.toThrow('CONFLICT');
    expect(await events.read(id, 0)).toEqual(before);
    expect((await restored.view(id, 'one', leaseBuyer)).state).toBe('POSTED');
    // Leave no open offer in the shared database used by pagination tests.
    await restored.claim(id, 'one', leaseBuilder, 7, 'on-time', deadline - 1);
    await restored.expireLease(id, 'one', leaseBuyer, 8, 'cleanup', deadline + 2 * 86400000);
  } finally {
    await connection.end();
  }
});
it('posts frozen terms and serialises real claims using authenticated operator identities', async () => {
  await board.create(input, buyer, 'create');
  await expect(board.post('bp', 'one', 'tranche', buyer, 1, 'early', at)).rejects.toThrow();
  await board.freeze(
    'bp',
    {
      version: 1,
      buyerOperatorId: 'buyer',
      approvalReference: 'sim-approved',
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
    'freeze',
  );
  await board.post('bp', 'one', 'tranche', buyer, 2, 'post', at);
  const claims = await Promise.allSettled([
    board.claim('bp', 'one', builder, 3, 'claim-a', at),
    board.claim('bp', 'one', other, 3, 'claim-b', at),
  ]);
  expect(claims.filter((c) => c.status === 'fulfilled')).toHaveLength(1);
  const winner = claims[0]?.status === 'fulfilled' ? builder : other;
  const key = winner === builder ? 'claim-a' : 'claim-b';
  const snapshot = await board.read('bp', buyer);
  expect((snapshot.data as { orders: Record<string, { actions: unknown[] }> }).orders.one?.actions).toHaveLength(1);
  expect(await board.claim('bp', 'one', winner, 3, key, at)).toEqual(snapshot);
  await expect(board.claim('bp', 'one', { ...winner, root: 'changed' }, 4, key, at + 1)).rejects.toThrow('CONFLICT');
  await expect(board.read('bp', { id: 'foreign', root: 'foreign', kind: 'BUYER' })).rejects.toThrow('FORBIDDEN');
  await board.build('bp', 'one', winner, 4, 'build', at);
  await board.submit('bp', 'one', 'd'.repeat(40), 'package', winner, 5, 'submit', at);
  expect(await board.view('bp', 'one', buyer)).toMatchObject({ state: 'CHECKING', payment: null });
  await expect(
    board.settlement(
      'bp',
      'one',
      {
        eventId: 'forged',
        trancheId: 'wrong',
        packageId: 'package',
        reference: 'capture',
        effect: 'CAPTURE',
        minor: 1000,
        currency: 'USD',
        simulated: true,
      },
      6,
    ),
  ).rejects.toThrow();
  const proof = {
    eventId: 'event',
    trancheId: 'tranche',
    packageId: 'package',
    reference: 'capture',
    effect: 'CAPTURE' as const,
    minor: 1000,
    currency: 'USD',
    simulated: true as const,
  };
  const paid = await board.settlement('bp', 'one', proof, 6);
  expect(await board.view('bp', 'one', buyer)).toMatchObject({
    state: 'PAID',
    payment: { reference: 'capture', simulated: true },
  });
  expect(await board.settlement('bp', 'one', proof, 6)).toEqual(paid);
  await expect(board.settlement('bp', 'one', { ...proof, reference: 'different' }, 7)).rejects.toThrow();
  const events = await new PostgresYardEvents(f.limited).read('bp', 0);
  expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(events[6]).toMatchObject({ type: 'stood.released', actor: 'stood' });
});

it('paginates beyond project 100 and keeps buyer repository out of discovery', async () => {
  for (let i = 0; i < 105; i++) {
    const id = `${i % 2 ? 'Page' : 'page'}-${String(i).padStart(3, '0')}`;
    await board.create({ ...input, id }, buyer, 'create');
    await board.freeze(
      id,
      {
        version: 1,
        buyerOperatorId: buyer.id,
        approvalReference: 'sim-approved',
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
      'freeze',
    );
    await board.post(id, 'one', `tranche-${id}`, buyer, 2, 'post', at);
  }
  const first = await board.discoverPage('', at);
  expect(first.nextCursor).not.toBeNull();
  const second = await board.discoverPage(first.nextCursor!, at);
  const orders = [...first.orders, ...second.orders];
  expect(orders).toHaveLength(105);
  expect(new Set(orders.map((o) => o.projectId)).size).toBe(105);
  expect(orders.some((o) => o.projectId === 'page-104')).toBe(true);
  expect(orders.map((o) => o.projectId)).toEqual(orders.map((o) => o.projectId).sort());
  expect(second.nextCursor).toBeNull();
  for (const o of orders) {
    expect(o).not.toHaveProperty('repository');
    expect(o).not.toHaveProperty('baseCommit');
    expect(o).not.toHaveProperty('buyerOperatorId');
  }
  await expect(board.discoverPage('invalid cursor', at)).rejects.toThrow('INVALID');
});

it('recovers a durable submission through a new connection and serialises competing receipt writers', async () => {
  const id = 'outbox-project';
  await board.create({ ...input, id }, buyer, 'create');
  await board.freeze(
    id,
    {
      version: 1,
      buyerOperatorId: buyer.id,
      approvalReference: 'sim-approved',
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
    'freeze',
  );
  await board.post(id, 'one', 'outbox-tranche', buyer, 2, 'post', at);
  await board.claim(id, 'one', builder, 3, 'claim', at);
  await board.build(id, 'one', builder, 4, 'build', at);
  const before = await board.prepareSubmission(id, 'one', 'd'.repeat(40), builder, 5, 'submit', at);
  const restartedPool = f.connectRuntime();
  try {
    const restartedBoard = new Board(new PostgresYardEvents(restartedPool));
    const after = await restartedBoard.prepareSubmission(id, 'one', 'd'.repeat(40), builder, 5, 'submit', at + 1);
    expect(after).toEqual(before);
    const gateway = {
      submit: async (request: typeof before.request) => ({
        id: 'durable-package',
        trancheId: request.trancheId,
        repository: request.repository,
        baseCommit: request.baseCommit,
        commit: request.commit,
      }),
    };
    const bridge = new SubmissionBridge(restartedBoard, gateway);
    const results = await Promise.all([
      bridge.submit(id, 'one', 'd'.repeat(40), builder, 5, 'submit', at + 1),
      bridge.submit(id, 'one', 'd'.repeat(40), builder, 5, 'submit', at + 1),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect((await restartedBoard.view(id, 'one', builder)).submission?.packageId).toBe('durable-package');
    expect((await new PostgresYardEvents(restartedPool).read(id, 0)).map((e) => e.type)).toEqual([
      'blueprint.ready',
      'blueprint.approved',
      'wo.posted',
      'wo.claimed',
      'wo.building',
      'submission.reserved',
      'wo.submitted',
    ]);
  } finally {
    await restartedPool.end();
  }
});
