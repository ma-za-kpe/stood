import { createHash, createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { confirmHold, leaseAt, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import type { AmendmentGateway } from '../application/allowance-amendments.js';
import { Board } from '../application/board.js';
import { MandateBridge } from '../application/mandate-bridge.js';
import { createYardApp } from './app.js';

const now = 1791158400000;
it('binds signatures to method/path/body, owns identities on the server and denies unauthenticated Board access', async () => {
  const board = new Board(new MemoryEvents());
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => now,
      operators: [
        { key: 'buyer-key', secret: 'buyer-secret', actor: { id: 'buyer', root: 'buyer-root', kind: 'BUYER' } },
      ],
    },
  });
  const path = '/yard/v1/board';
  const t = String(now / 1000);
  const sig = createHmac('sha256', 'buyer-secret')
    .update(JSON.stringify(['yard.request@2', t, 'buyer-key', 'GET', path, '', '', '', '', '']))
    .digest('hex');
  const headers = { 'Yard-Key-Id': 'buyer-key', 'Yard-Signature': `t=${t},v2=${sig}` };
  expect((await app.request(path)).status).toBe(401);
  expect((await app.request(path, { headers })).status).toBe(200);
  for (const [target, changed] of [
    [`${path}?after=foreign`, {}],
    [path, { 'Idempotency-Key': 'another-command' }],
    [path, { 'If-Match': '77' }],
    [path, { 'Last-Event-ID': '99' }],
    [path, { 'Content-Type': 'application/json' }],
  ] as const)
    expect((await app.request(target, { headers: { ...headers, ...changed } })).status).toBe(401);
  expect((await app.request('/yard/v1/blueprints/private', { headers })).status).toBe(401);
  expect(
    (await app.request(path, { headers: { ...headers, 'Yard-Signature': `t=${Number(t) - 301},v2=${sig}` } })).status,
  ).toBe(401);
  expect((await app.request(path, { headers: { ...headers, 'Yard-Key-Id': 'unknown' } })).status).toBe(401);
  expect(
    (
      await app.request(path, {
        headers: {
          ...headers,
          'Yard-Signature': `t=${t},v1=${createHmac('sha256', 'buyer-secret').update(`${t}.GET.${path}.`).digest('hex')}`,
        },
      })
    ).status,
  ).toBe(401);
  expect((await (await app.request('/health')).json()).capabilities).toMatchObject({
    board: true,
    events: true,
    payments: false,
  });
});
it('binds the operator key ID even when a configuration accidentally shares a secret', async () => {
  const path = '/yard/v1/board',
    t = String(now / 1000),
    secret = 'fixture-shared-secret';
  const app = createYardApp({
    environment: 'ci',
    board: {
      board: new Board(new MemoryEvents()),
      clock: async () => now,
      operators: ['buyer', 'other'].map((id) => ({
        key: `${id}-key`,
        secret,
        actor: { id, root: `${id}-root`, kind: 'BUYER' as const },
      })),
    },
  });
  const headers = {
    'Yard-Key-Id': 'buyer-key',
    'Yard-Signature': `t=${t},v2=${createHmac('sha256', secret)
      .update(JSON.stringify(['yard.request@2', t, 'buyer-key', 'GET', path, '', '', '', '', '']))
      .digest('hex')}`,
  };
  expect((await app.request(path, { headers })).status).toBe(200);
  expect((await app.request(path, { headers: { ...headers, 'Yard-Key-Id': 'other-key' } })).status).toBe(401);
});

it('delivers a signed evidence amendment through the hosted Yard route and requires a separate consent step', async () => {
  const events = new MemoryEvents();
  const board = new Board(events);
  const tests = [{ id: 'works', path: 'tests/works.test.js' }];
  const manifestHash = createHash('sha256').update(JSON.stringify(tests)).digest('hex');
  const milestones = ['one', 'two'].map((id) => ({
    id,
    name: id,
    budgetMinor: 1000,
    deadline: leaseAt + 86400000,
    profileId: id === 'two' ? ('code.final@1' as const) : ('code.milestone@1' as const),
    testBundleHash: 'a'.repeat(64),
    manifestHash,
    testIds: ['works'],
    tests,
  }));
  await board.create(
    {
      id: 'p',
      buyerOperatorId: leaseBuyer.id,
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
    'p',
    {
      version: 1,
      buyerOperatorId: leaseBuyer.id,
      approvalReference: 'approved',
      baselines: milestones.map((m) => ({
        milestoneId: m.id,
        testBundleHash: m.testBundleHash,
        manifestHash,
        failedTestIds: m.testIds,
        reference: 'baseline-original',
      })),
    },
    leaseBuyer,
    1,
    'freeze',
  );
  await new MandateBridge(board, {
    createDraft: async () => ({ id: 'alw_1', tranches: milestones.map((m) => ({ id: `trn_${m.id}`, name: m.name })) }),
  }).create('p', leaseBuyer, 2, 'mandate', leaseAt);
  const changes = [{ milestoneId: 'two', testBundleHash: 'b'.repeat(64), manifestHash, testIds: ['works'], tests }];
  const amendmentGateway: AmendmentGateway = {
    requestBaseline: async (terms: {
      repository: string;
      baseCommit: string;
      testBundleHash: string;
      testIds: readonly string[];
    }) => ({
      id: 'baseline-2',
      status: 'DONE' as const,
      repository: terms.repository,
      baseCommit: terms.baseCommit,
      testBundleHash: terms.testBundleHash,
      tests: terms.testIds.map((id) => ({ id, status: 'FAIL' as const })),
      evidenceSha256: 'c'.repeat(64),
    }),
    proposeAllowanceVersion: async (_id, version, body) => ({
      version: version + 1,
      termsHash: 'd'.repeat(64),
      body: {
        ...body,
        id: 'alw_1',
        status: 'DRAFT',
        tranches: milestones.map((m) => ({ id: `trn_${m.id}`, name: m.name })),
      },
    }),
    requestVersionMandate: async (_id: string, _version: number, key: string) => ({
      key,
      status: 'AWAITING_APPROVAL' as const,
      approveUrl: 'https://www.sandbox.paypal.com/agreements/approve?ba_token=fixture',
      expiresAt: leaseAt + 86400000,
    }),
  };
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => leaseAt,
      operators: [{ key: 'buyer-key', secret: 'buyer-secret', actor: leaseBuyer }],
      amendments: amendmentGateway,
    },
  });
  const send = async (path: string, value: unknown, key: string, version: number) => {
    const raw = JSON.stringify(value);
    const timestamp = String(leaseAt / 1000);
    return app.request(path, {
      method: 'POST',
      body: raw,
      headers: {
        'Yard-Key-Id': 'buyer-key',
        'Yard-Signature': `t=${timestamp},v2=${createHmac('sha256', 'buyer-secret')
          .update(
            JSON.stringify([
              'yard.request@2',
              timestamp,
              'buyer-key',
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
  const boardVersion = (await events.load('p')).version;
  const response = await send('/yard/v1/blueprints/p/amendments', { changes }, 'amend', boardVersion);
  const result = await response.json();
  expect({ status: response.status, result }).toMatchObject({
    status: 200,
    result: { status: 'AWAITING_APPROVAL', termsVersion: 2 },
  });
  expect((await board.room('p', leaseBuyer)).mandate?.amendmentRequired).toEqual(['two']);
  expect((await events.read('p', 0)).some((event) => event.type === 'stood.amendment_reserved')).toBe(true);
  expect((await send('/yard/v1/blueprints/p/amendments', { changes }, 'amend', boardVersion)).status).toBe(200);
});

it('runs signed Board commands, keeps submissions checking and requires matching signed Stood proof', async () => {
  const store = new MemoryEvents();
  const board = new Board(store);
  const submissions: unknown[] = [];
  let proof = {
    trancheId: 'tranche',
    packageId: 'package',
    reference: 'capture',
    effect: 'CAPTURE' as const,
    minor: 1000,
    currency: 'USD',
    simulated: true as const,
  };
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => now,
      operators: [
        { key: 'buyer-key', secret: 'buyer-secret', actor: { id: 'buyer', root: 'buyer-root', kind: 'BUYER' } },
        { key: 'builder-key', secret: 'builder-secret', actor: { id: 'builder', root: 'buyer-root', kind: 'BUILDER' } },
      ],
      packages: {
        submit: async (input) => {
          submissions.push(input);
          return {
            id: 'package',
            trancheId: input.trancheId,
            repository: input.repository,
            baseCommit: input.baseCommit,
            commit: input.commit,
          };
        },
      },
      stood: { mode: 'sim', secret: 'sim-stood-webhook-secret', read: async () => proof },
    },
  });
  const request = async (
    path: string,
    method = 'GET',
    value?: unknown,
    version = 1,
    key = 'request',
    who = 'buyer',
  ) => {
    const raw = value === undefined ? '' : JSON.stringify(value),
      t = String(now / 1000);
    return app.request(path, {
      method,
      ...(raw ? { body: raw } : {}),
      headers: {
        'Yard-Key-Id': `${who}-key`,
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', `${who}-secret`)
          .update(
            JSON.stringify([
              'yard.request@2',
              t,
              `${who}-key`,
              method,
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
  const milestone = (id: string, profileId: string) => ({
    id,
    name: id,
    budgetMinor: 1000,
    deadline: now + 86400000,
    profileId,
    testBundleHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    testIds: ['works'],
  });
  const input = {
    id: 'p',
    buyerOperatorId: 'buyer',
    repository: 'buyer/project',
    baseCommit: 'a'.repeat(40),
    summary: 'Booking app',
    capMinor: 2000,
    currency: 'USD',
    milestones: [milestone('one', 'code.milestone@1'), milestone('two', 'code.final@1')],
  };
  expect((await request('/yard/v1/blueprints', 'POST', { ...input, operatorRootId: 'forged' })).status).toBe(422);
  expect((await request('/yard/v1/blueprints', 'POST', input, 1, 'create')).status).toBe(201);
  expect(
    (
      await request(
        '/yard/v1/blueprints/p/approve',
        'POST',
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
        1,
        'freeze',
      )
    ).status,
  ).toBe(200);
  expect(
    (await request('/yard/v1/blueprints/p/work-orders', 'POST', { milestone: 'one', trancheId: 'tranche' }, 2, 'post'))
      .status,
  ).toBe(200);
  expect((await (await request('/yard/v1/board')).json()).orders).toHaveLength(1);
  const base = '/yard/v1/blueprints/p/work-orders/one';
  expect((await request(`${base}/claim`, 'POST', {}, 3, 'claim', 'builder')).status).toBe(200);
  // Work cannot start until Stood confirms a hold for this attempt.
  expect((await request(`${base}/build`, 'POST', {}, 4, 'early', 'builder')).status).toBe(409);
  await confirmHold(board, 'p', 'one', now);
  expect((await request(`${base}/build`, 'POST', {}, 5, 'build', 'buyer')).status).toBe(403);
  expect((await request(`${base}/build`, 'POST', {}, 5, 'build', 'builder')).status).toBe(200);
  expect((await request(`${base}/submit`, 'POST', { commit: 'd'.repeat(40) }, 6, 'submit', 'builder')).status).toBe(
    200,
  );
  expect(submissions).toHaveLength(1);
  expect((await request(`${base}/submit`, 'POST', { commit: 'd'.repeat(40) }, 6, 'submit', 'builder')).status).toBe(
    200,
  );
  expect(submissions).toHaveLength(1);
  expect((await request(`${base}/submit`, 'POST', { commit: 'e'.repeat(40) }, 6, 'submit', 'builder')).status).toBe(
    409,
  );
  expect((await request(`${base}/submit`, 'POST', { commit: 'd'.repeat(40) }, 7, 'different', 'builder')).status).toBe(
    409,
  );
  expect(submissions).toHaveLength(1);
  const before = await (await request(base)).json();
  expect(before).toMatchObject({ state: 'CHECKING', payment: null, currentClaim: { outsideOperator: false } });
  const event = {
    id: 'event',
    type: 'stood.released',
    projectId: 'p',
    wo: 'one',
    trancheId: 'tranche',
    packageId: 'package',
    reference: 'capture',
    simulated: true,
  };
  const webhook = async (value: unknown, secret = 'sim-stood-webhook-secret') => {
    const raw = JSON.stringify(value),
      t = String(now / 1000);
    return app.request('/yard/v1/webhooks/stood', {
      method: 'POST',
      body: raw,
      headers: { 'Stood-Signature': `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` },
    });
  };
  expect((await webhook(event, 'forged')).status).toBe(401);
  proof = { ...proof, reference: 'other' };
  expect((await webhook(event)).status).toBe(422);
  expect((await (await request(base)).json()).state).toBe('CHECKING');
  proof = { ...proof, reference: 'capture' };
  expect((await webhook(event)).status).toBe(200);
  expect((await webhook(event)).status).toBe(200);
  expect((await (await request(base)).json()).state).toBe('PAID');
  expect((await (await request('/yard/v1/board')).json()).orders).toHaveLength(0);
  expect((await request(`${base}/submit`, 'POST', { commit: 'e'.repeat(40) }, 8, 'changed', 'builder')).status).toBe(
    409,
  );
  await expect(board.settlement('p', 'one', { ...proof, eventId: 'different' }, 9)).rejects.toThrow('INVALID');
  await expect(
    board.create({ ...input, id: '__proto__' } as never, { id: 'buyer', root: 'buyer-root', kind: 'BUYER' }, 'bad'),
  ).rejects.toThrow('INVALID');
});
