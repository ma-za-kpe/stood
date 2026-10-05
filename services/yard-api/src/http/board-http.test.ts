import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from '../application/board.js';
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
  const sig = createHmac('sha256', 'buyer-secret').update(`${t}.GET.${path}.`).digest('hex');
  const headers = { 'Yard-Key-Id': 'buyer-key', 'Yard-Signature': `t=${t},v1=${sig}` };
  expect((await app.request(path)).status).toBe(401);
  expect((await app.request(path, { headers })).status).toBe(200);
  expect((await app.request('/yard/v1/blueprints/private', { headers })).status).toBe(401);
  expect(
    (await app.request(path, { headers: { ...headers, 'Yard-Signature': `t=${Number(t) - 301},v1=${sig}` } })).status,
  ).toBe(401);
  expect((await app.request(path, { headers: { ...headers, 'Yard-Key-Id': 'unknown' } })).status).toBe(401);
  expect((await (await app.request('/health')).json()).capabilities).toMatchObject({
    board: true,
    events: true,
    payments: false,
  });
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
          return 'package';
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
        'Yard-Signature': `t=${t},v1=${createHmac('sha256', `${who}-secret`).update(`${t}.${method}.${path}.${raw}`).digest('hex')}`,
        'Idempotency-Key': key,
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
  expect((await request(`${base}/build`, 'POST', {}, 4, 'build', 'buyer')).status).toBe(403);
  expect((await request(`${base}/build`, 'POST', {}, 4, 'build', 'builder')).status).toBe(200);
  expect((await request(`${base}/submit`, 'POST', { commit: 'd'.repeat(40) }, 5, 'submit', 'builder')).status).toBe(
    200,
  );
  expect(submissions).toHaveLength(1);
  expect((await request(`${base}/submit`, 'POST', { commit: 'd'.repeat(40) }, 5, 'submit', 'builder')).status).toBe(
    200,
  );
  expect(submissions).toHaveLength(1);
  expect((await request(`${base}/submit`, 'POST', { commit: 'e'.repeat(40) }, 5, 'submit', 'builder')).status).toBe(
    409,
  );
  expect((await request(`${base}/submit`, 'POST', { commit: 'd'.repeat(40) }, 6, 'different', 'builder')).status).toBe(
    403,
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
  expect((await request(`${base}/submit`, 'POST', { commit: 'e'.repeat(40) }, 7, 'changed', 'builder')).status).toBe(
    403,
  );
  await expect(board.settlement('p', 'one', { ...proof, eventId: 'different' }, 7)).rejects.toThrow('INVALID');
  await expect(
    board.create({ ...input, id: '__proto__' } as never, { id: 'buyer', root: 'buyer-root', kind: 'BUYER' }, 'bad'),
  ).rejects.toThrow('INVALID');
});
