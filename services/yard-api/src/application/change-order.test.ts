import { expect, it } from 'vitest';
import { leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from './board.js';
import { MandateBridge } from './mandate-bridge.js';

const day = 86400000;
async function signed() {
  const board = new Board(new MemoryEvents());
  const milestones = ['one', 'two', 'three'].map((id, i) => ({
    id,
    name: `Milestone ${id}`,
    budgetMinor: 1000,
    deadline: leaseAt + (i + 1) * 5 * day,
    profileId: (i === 2 ? 'code.final@1' : 'code.milestone@1') as 'code.final@1' | 'code.milestone@1',
    testBundleHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    testIds: ['works'],
  }));
  await board.create(
    {
      id: 'p',
      buyerOperatorId: 'buyer',
      repository: 'buyer/project',
      baseCommit: 'a'.repeat(40),
      summary: 'Booking',
      createdAt: leaseAt,
      capMinor: 3000,
      currency: 'USD',
      milestones,
    },
    leaseBuyer,
    'create',
  );
  await board.freeze(
    'p',
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
  const version = async () => (await board.events.load('p')).version;
  return { board, version };
}

it('keeps signed terms immutable and applies a change only after explicit buyer approval (T-0212)', async () => {
  const { board, version } = await signed();
  await board.post('p', 'one', 'trn-1', leaseBuyer, 2, 'post', leaseAt);
  const change = [
    { milestoneId: 'two', name: 'Deposits and reminders', budgetMinor: 1400, deadline: leaseAt + 12 * day },
    { milestoneId: 'three', name: 'Milestone three', budgetMinor: 600, deadline: leaseAt + 15 * day },
  ];
  // Posted milestones, other buyers, builders, a changed total and duplicates are refused.
  for (const [actor, changes, code] of [
    [leaseBuilder, change, 'FORBIDDEN'],
    [{ id: 'x', root: 'x', kind: 'BUYER' }, change, 'FORBIDDEN'],
    [leaseBuyer, [{ ...change[0], milestoneId: 'one' }], 'CONFLICT'],
    [leaseBuyer, [change[0]], 'INVALID'],
    [leaseBuyer, [change[0], change[0]], 'INVALID'],
    [
      leaseBuyer,
      [
        { ...change[0], budgetMinor: 0 },
        { ...change[1], budgetMinor: 2000 },
      ],
      'INVALID',
    ],
    [leaseBuyer, [{ ...change[0], deadline: leaseAt - 1 }, change[1]], 'INVALID'],
    [leaseBuyer, [{ ...change[0], milestoneId: 'nope' }, change[1]], 'INVALID'],
  ] as const)
    await expect(
      board.proposeChange('p', actor, await version(), `bad-${code}-${Math.random()}`, leaseAt, changes as never),
    ).rejects.toThrow(code);
  const proposed = await board.proposeChange('p', leaseBuyer, await version(), 'change', leaseAt, change);
  expect(proposed.version).toBe(4);
  // Proposed is not approved: the Board still offers the signed terms.
  let offer = (await board.discoverPage('', leaseAt)).orders;
  expect(offer.map((o) => o.priceMinor)).toEqual([1000]);
  await expect(board.proposeChange('p', leaseBuyer, 4, 'second', leaseAt, change)).rejects.toThrow('CONFLICT');
  await expect(board.approveChange('p', leaseBuilder, 4, 'approve', 'change-1')).rejects.toThrow('FORBIDDEN');
  await board.approveChange('p', leaseBuyer, 4, 'approve', 'change-1');
  await board.post('p', 'two', 'trn-2', leaseBuyer, 5, 'post-two', leaseAt);
  offer = (await board.discoverPage('', leaseAt)).orders;
  expect(offer.find((o) => o.workOrderId === 'two')).toMatchObject({
    name: 'Deposits and reminders',
    priceMinor: 1400,
  });
  const room = await board.room('p', leaseBuyer);
  expect(room.changes).toEqual([{ id: 'change-1', status: 'APPROVED', milestones: ['two', 'three'] }]);
  // The original signed snapshot is untouched.
  const raw = (await board.events.load('p')).data as { blueprint: { milestones: { budgetMinor: number }[] } };
  expect(raw.blueprint.milestones.map((m) => m.budgetMinor)).toEqual([1000, 1000, 1000]);
  const types = (await board.events.read('p', 0)).map((e) => e.type);
  expect(types).toContain('blueprint.change_proposed');
  expect(types).toContain('blueprint.change_approved');
});

it('uses approved terms for a later Stood mandate and blocks posting changed milestones of an existing one', async () => {
  const { board, version } = await signed();
  const change = [
    { milestoneId: 'one', name: 'Milestone one', budgetMinor: 1500, deadline: leaseAt + 5 * day },
    { milestoneId: 'two', name: 'Milestone two', budgetMinor: 500, deadline: leaseAt + 10 * day },
  ];
  await board.proposeChange('p', leaseBuyer, await version(), 'change', leaseAt, change);
  await board.approveChange('p', leaseBuyer, await version(), 'approve', 'change-1');
  const requests: { milestones: { amount: { minor: number } }[] }[] = [];
  const bridge = new MandateBridge(board, {
    createDraft: async (input) => {
      requests.push(input as never);
      return { id: 'alw', tranches: input.milestones.map((m, i) => ({ id: `t${i}`, name: m.name })) };
    },
  });
  await bridge.create('p', leaseBuyer, await version(), 'mandate', leaseAt);
  expect(requests[0]?.milestones.map((m) => m.amount.minor)).toEqual([1500, 500, 1000]);
  // A change after the allowance exists needs a Stood amendment before those milestones can be posted.
  await board.proposeChange('p', leaseBuyer, await version(), 'late', leaseAt, [
    { milestoneId: 'two', name: 'Milestone two', budgetMinor: 600, deadline: leaseAt + 10 * day },
    { milestoneId: 'three', name: 'Milestone three', budgetMinor: 900, deadline: leaseAt + 15 * day },
  ]);
  await board.approveChange('p', leaseBuyer, await version(), 'approve-late', 'change-2');
  await expect(board.post('p', 'two', undefined, leaseBuyer, await version(), 'post-two', leaseAt)).rejects.toThrow(
    'CONFLICT',
  );
  await board.post('p', 'one', undefined, leaseBuyer, await version(), 'post-one', leaseAt);
  expect((await board.room('p', leaseBuyer)).mandate).toEqual({
    allowanceId: 'alw',
    status: 'DRAFT',
    amendmentRequired: ['two', 'three'],
  });
});

it('proposes and approves a change order over signed HTTP', async () => {
  const { createHmac } = await import('node:crypto');
  const { createYardApp } = await import('../http/app.js');
  const { board, version } = await signed();
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => leaseAt,
      operators: [{ key: 'buyer-key', secret: 'buyer-secret', actor: leaseBuyer }],
    },
  });
  const call = async (path: string, value: unknown, key: string) => {
    const raw = JSON.stringify(value),
      t = String(leaseAt / 1000),
      v = String(await version());
    return app.request(path, {
      method: 'POST',
      body: raw,
      headers: {
        'Yard-Key-Id': 'buyer-key',
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', 'buyer-secret')
          .update(JSON.stringify(['yard.request@2', t, 'buyer-key', 'POST', path, key, v, 'application/json', '', raw]))
          .digest('hex')}`,
        'Idempotency-Key': key,
        'Content-Type': 'application/json',
        'If-Match': v,
      },
    });
  };
  const changes = [
    { milestoneId: 'one', name: 'Milestone one', budgetMinor: 1200, deadline: leaseAt + 5 * day },
    { milestoneId: 'two', name: 'Milestone two', budgetMinor: 800, deadline: leaseAt + 10 * day },
  ];
  expect((await call('/yard/v1/blueprints/p/changes', { changes: 'all' }, 'bad')).status).toBe(422);
  expect((await call('/yard/v1/blueprints/p/changes', { changes }, 'change')).status).toBe(200);
  expect((await call('/yard/v1/blueprints/p/changes/change-1/approve', {}, 'approve')).status).toBe(200);
  expect((await board.room('p', leaseBuyer)).changes).toEqual([
    { id: 'change-1', status: 'APPROVED', milestones: ['one', 'two'] },
  ]);
});
