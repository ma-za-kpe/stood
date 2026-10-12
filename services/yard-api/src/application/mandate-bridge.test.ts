import { expect, it, vi } from 'vitest';
import { leaseAt, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board, yardFee } from './board.js';
import { type DraftGateway, MandateBridge } from './mandate-bridge.js';

async function frozen(id = 'p', limits?: ConstructorParameters<typeof Board>[1]) {
  const board = new Board(new MemoryEvents(), limits);
  const milestones = ['one', 'two'].map((m, i) => ({
    id: m,
    name: i ? 'Buyer uses the app' : 'Build the booking app',
    budgetMinor: i ? 1500 : 2500,
    deadline: leaseAt + (i ? 20 : 10) * 86400000,
    profileId: (i ? 'code.final@1' : 'code.milestone@1') as 'code.final@1' | 'code.milestone@1',
    testBundleHash: `${i}`.repeat(64),
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
      capMinor: 4000,
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
  return board;
}
const draft = (input: Parameters<DraftGateway['createDraft']>[0]) => ({
  id: 'alw_1',
  status: 'DRAFT' as const,
  cap: input.cap,
  tranches: input.milestones.map((m, i) => ({ id: `trn_${i + 1}`, name: m.name })),
});

it('reserves the exact frozen terms before calling Stood and maps each tranche to its milestone (T-0184)', async () => {
  const board = await frozen();
  const calls: unknown[] = [];
  const gateway: DraftGateway = {
    createDraft: vi.fn(async (input, key) => {
      calls.push({ input, key });
      // The reservation is durable before any request leaves Yard.
      expect((await board.events.read('p', 0)).at(-1)?.type).toBe('stood.allowance_reserved');
      return draft(input);
    }),
  };
  const bridge = new MandateBridge(board, gateway);
  const result = await bridge.create('p', leaseBuyer, 2, 'mandate', leaseAt);
  expect(result).toMatchObject({ allowanceId: 'alw_1', tranches: { one: 'trn_1', two: 'trn_2' } });
  expect(calls).toEqual([
    {
      key: expect.stringMatching(/^yard-mandate:[a-f0-9]{64}$/),
      input: {
        payee_ref: 'yard:p',
        cap: { minor: 4000, currency: 'USD' },
        milestones: [
          {
            name: 'Build the booking app',
            amount: { minor: 2500, currency: 'USD' },
            profile: 'code.milestone@1',
            params: {
              repository: 'buyer/project',
              baseCommit: 'a'.repeat(40),
              testBundleHash: '0'.repeat(64),
              manifestHash: 'c'.repeat(64),
              testIds: ['works'],
            },
          },
          {
            name: 'Buyer uses the app',
            amount: { minor: 1500, currency: 'USD' },
            profile: 'code.final@1',
            params: {
              repository: 'buyer/project',
              baseCommit: 'a'.repeat(40),
              testBundleHash: '1'.repeat(64),
              manifestHash: 'c'.repeat(64),
              testIds: ['works'],
            },
          },
        ],
        window_days: 20,
        max_resubmits: 1,
      },
    },
  ]);
  // Exact replay returns the stored result without calling Stood again.
  expect(await bridge.create('p', leaseBuyer, 2, 'mandate', leaseAt + 1)).toEqual(result);
  expect(gateway.createDraft).toHaveBeenCalledOnce();
  // Posting now uses Stood's tranche, never a caller-chosen one.
  const posted = await board.post('p', 'one', undefined, leaseBuyer, 4, 'post', leaseAt);
  expect((posted.data as { orders: { one: { trancheId: string } } }).orders.one.trancheId).toBe('trn_1');
  await expect(board.post('p', 'two', 'trn_forged', leaseBuyer, 5, 'post-2', leaseAt)).rejects.toThrow('INVALID');
  expect((await board.room('p', leaseBuyer)).mandate).toEqual({ allowanceId: 'alw_1', status: 'DRAFT' });
});

it('recovers a lost Stood reply with the same key and rejects a draft that does not match the terms', async () => {
  const board = await frozen();
  let lose = true;
  const keys: string[] = [];
  const gateway: DraftGateway = {
    createDraft: async (input, key) => {
      keys.push(key);
      if (lose) {
        lose = false;
        throw new Error('reply lost');
      }
      return draft(input);
    },
  };
  const bridge = new MandateBridge(board, gateway);
  await expect(bridge.create('p', leaseBuyer, 2, 'mandate', leaseAt)).rejects.toThrow('reply lost');
  expect((await bridge.recover())[0]).toMatchObject({ projectId: 'p', status: 'DELIVERED' });
  expect(new Set(keys).size).toBe(1);
  // Unsigned blueprints, other buyers and mismatched drafts are refused.
  const unsigned = new Board(new MemoryEvents());
  await expect(new MandateBridge(unsigned, gateway).create('none', leaseBuyer, 1, 'k', leaseAt)).rejects.toThrow();
  const other = await frozen('q');
  await expect(
    new MandateBridge(other, gateway).create('q', { id: 'x', root: 'x', kind: 'BUYER' }, 2, 'k', leaseAt),
  ).rejects.toThrow('FORBIDDEN');
  const wrong = await frozen('r');
  const mismatched: DraftGateway = {
    createDraft: async (input) => ({ ...draft(input), tranches: [{ id: 'trn_1', name: 'Something else' }] }),
  };
  await expect(new MandateBridge(wrong, mismatched).create('r', leaseBuyer, 2, 'k', leaseAt)).rejects.toThrow(
    'INVALID',
  );
});

it('creates the mandate over signed HTTP for the owning buyer only', async () => {
  const { createHmac } = await import('node:crypto');
  const { createYardApp } = await import('../http/app.js');
  const board = await frozen();
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => leaseAt,
      mandates: { createDraft: async (input) => draft(input) },
      operators: [
        { key: 'buyer-key', secret: 'buyer-secret', actor: leaseBuyer },
        { key: 'other-key', secret: 'other-secret', actor: { id: 'other', root: 'other', kind: 'BUYER' } },
      ],
    },
  });
  const call = (who: string, path: string, value: unknown, version: number, key: string) => {
    const raw = JSON.stringify(value),
      t = String(leaseAt / 1000);
    return app.request(path, {
      method: 'POST',
      body: raw,
      headers: {
        'Yard-Key-Id': `${who}-key`,
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', `${who}-secret`)
          .update(
            JSON.stringify([
              'yard.request@2',
              t,
              `${who}-key`,
              'POST',
              path,
              key,
              String(version),
              'application/json',
              '',
              raw,
            ]),
          )
          .digest('hex')}`,
        'Idempotency-Key': key,
        'Content-Type': 'application/json',
        'If-Match': String(version),
      },
    });
  };
  expect((await call('other', '/yard/v1/blueprints/p/mandate', {}, 2, 'm')).status).toBe(403);
  const created = await call('buyer', '/yard/v1/blueprints/p/mandate', {}, 2, 'm');
  expect(created.status).toBe(200);
  expect(await created.json()).toMatchObject({ allowanceId: 'alw_1', status: 'DRAFT', tranches: { one: 'trn_1' } });
  expect((await call('buyer', '/yard/v1/blueprints/p/work-orders', { milestone: 'one' }, 4, 'post')).status).toBe(200);
});

// ADR-0027: the buyer pays Yard's fee on top of each milestone, in the same hold; the builder's price is unchanged.
it('holds each milestone as the builder price plus Yard fee, and returns both lines to the buyer', async () => {
  const board = await frozen('fee', { maxActiveClaims: 2, payee: 'ABCDEFGHJKLMN', feeBps: 500 });
  let sent: Parameters<DraftGateway['createDraft']>[0] | undefined;
  const bridge = new MandateBridge(board, {
    createDraft: async (input) => {
      sent = input;
      return draft(input);
    },
  });
  const result = await bridge.create('fee', leaseBuyer, 2, 'mandate', leaseAt);
  expect(result.lines).toEqual([
    { milestoneId: 'one', builderMinor: 2500, feeMinor: 125 },
    { milestoneId: 'two', builderMinor: 1500, feeMinor: 75 },
  ]);
  expect(sent?.payee_ref).toBe('ABCDEFGHJKLMN');
  expect(sent?.cap).toEqual({ minor: 4200, currency: 'USD' });
  expect(sent?.milestones.map((m) => m.amount.minor)).toEqual([2625, 1575]);
  // The example in ADR-0027: £500 to the builder, £25 to Yard, a £525 hold. Rounded to the nearest minor unit.
  expect(yardFee(50_000, 500)).toBe(2500);
  expect(yardFee(333, 500)).toBe(17);
  expect(yardFee(1000, 0)).toBe(0);
  // A retry returns the same lines.
  expect((await bridge.create('fee', leaseBuyer, 2, 'mandate', leaseAt)).lines).toEqual(result.lines);
});
// Sixth audit (2026-10-11): an unrelated write while the allowance draft is in flight must not strand it.
it('recovers a lost Stood reply after an unrelated project write made the reserved version stale', async () => {
  const board = await frozen();
  let lose = true;
  const gateway: DraftGateway = {
    createDraft: async (input) => {
      if (lose) {
        lose = false;
        throw new Error('reply lost');
      }
      return draft(input);
    },
  };
  await expect(new MandateBridge(board, gateway).create('p', leaseBuyer, 2, 'mandate', leaseAt)).rejects.toThrow(
    'reply lost',
  );
  const { version } = await board.events.load('p');
  await board.events.mutate('p', version, 'yard', 'unrelated', 'unrelated', (raw) => ({
    data: raw,
    type: 'project.noted',
    payload: {},
  }));
  expect(await new MandateBridge(board, gateway).recover()).toEqual([{ projectId: 'p', status: 'DELIVERED' }]);
  expect(await new MandateBridge(board, gateway).recover()).toEqual([]);
});
