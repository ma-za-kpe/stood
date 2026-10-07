import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { confirmHold } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board, type StoodProof } from '../application/board.js';
import { createYardApp } from './app.js';

const now = 1791158400000;
function harness() {
  const board = new Board(new MemoryEvents());
  let packages = 0;
  const state: { proof: StoodProof } = {
    proof: {
      trancheId: 'tranche',
      packageId: 'package-1',
      reference: 'void-1',
      effect: 'VOID',
      punchList: [{ field: 'signed_tests_changed', reason: 'The signed tests were changed.' }],
      resubmissionsLeft: 1,
      simulated: true,
    },
  };
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => now,
      operators: [
        { key: 'buyer-key', secret: 'buyer-secret', actor: { id: 'buyer', root: 'buyer-root', kind: 'BUYER' } },
        {
          key: 'builder-key',
          secret: 'builder-secret',
          actor: { id: 'builder', root: 'builder-root', kind: 'BUILDER' },
        },
      ],
      packages: {
        submit: async (input) => ({
          id: `package-${++packages}`,
          trancheId: input.trancheId,
          repository: input.repository,
          baseCommit: input.baseCommit,
          commit: input.commit,
        }),
      },
      stood: { mode: 'sim', secret: 'sim-stood-webhook-secret', read: async () => state.proof },
    },
  });
  const request = async (path: string, method = 'GET', value?: unknown, version = 1, key = 'r', who = 'buyer') => {
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
  const webhook = async (value: unknown, secret = 'sim-stood-webhook-secret') => {
    const raw = JSON.stringify(value),
      t = String(now / 1000);
    return app.request('/yard/v1/webhooks/stood', {
      method: 'POST',
      body: raw,
      headers: { 'Stood-Signature': `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` },
    });
  };
  const version = async () => (await board.events.load('p')).version;
  const base = '/yard/v1/blueprints/p/work-orders/one';
  const setup = async () => {
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
    const milestones = [milestone('one', 'code.milestone@1'), milestone('two', 'code.final@1')];
    expect(
      (
        await request(
          '/yard/v1/blueprints',
          'POST',
          {
            id: 'p',
            buyerOperatorId: 'buyer',
            repository: 'buyer/project',
            baseCommit: 'a'.repeat(40),
            summary: 'Booking app',
            capMinor: 2000,
            currency: 'USD',
            milestones,
          },
          1,
          'create',
        )
      ).status,
    ).toBe(201);
    const baselines = milestones.map((m) => ({
      milestoneId: m.id,
      testBundleHash: m.testBundleHash,
      manifestHash: m.manifestHash,
      failedTestIds: m.testIds,
      reference: 'sim-red',
    }));
    const approval = { version: 1, buyerOperatorId: 'buyer', approvalReference: 'sim', baselines };
    expect((await request('/yard/v1/blueprints/p/approve', 'POST', approval, 1, 'freeze')).status).toBe(200);
    const post = { milestone: 'one', trancheId: 'tranche' };
    expect((await request('/yard/v1/blueprints/p/work-orders', 'POST', post, 2, 'post')).status).toBe(200);
    expect((await request(`${base}/claim`, 'POST', {}, 3, 'claim', 'builder')).status).toBe(200);
    await confirmHold(board, 'p', 'one', now);
    expect((await request(`${base}/build`, 'POST', {}, 5, 'build', 'builder')).status).toBe(200);
    const submit = { commit: 'd'.repeat(40) };
    expect((await request(`${base}/submit`, 'POST', submit, 6, 'submit-1', 'builder')).status).toBe(200);
    expect(await (await request(base)).json()).toMatchObject({
      state: 'CHECKING',
      submission: { packageId: 'package-1' },
    });
  };
  const refused = {
    id: 'refusal-1',
    type: 'stood.refused',
    projectId: 'p',
    wo: 'one',
    trancheId: 'tranche',
    packageId: 'package-1',
    reference: 'void-1',
    simulated: true,
  };
  return { board, state, request, webhook, version, base, setup, refused };
}

it('projects a verified Stood refusal as rework with a punch list, then pays the reworked package (T-0189)', async () => {
  const { board, state, request, webhook, version, base, setup, refused } = harness();
  await setup();
  expect((await webhook(refused, 'forged')).status).toBe(401);
  expect((await webhook({ ...refused, type: 'stood.voided' })).status).toBe(422);
  for (const proof of [
    { ...state.proof, reference: 'other' },
    { ...state.proof, packageId: 'package-other' },
    { ...state.proof, trancheId: 'other' },
    { ...state.proof, punchList: [] },
    { ...state.proof, punchList: [{ field: 'Bad Field', reason: 'x' }] },
    { ...state.proof, resubmissionsLeft: -1 },
  ]) {
    const saved = state.proof;
    state.proof = proof as StoodProof;
    expect((await webhook(refused)).status).toBe(422);
    state.proof = saved;
  }
  expect((await (await request(base)).json()).state).toBe('CHECKING');
  expect((await webhook(refused)).status).toBe(200);
  expect((await webhook(refused)).status).toBe(200);
  const rework = await (await request(base)).json();
  expect(rework).toMatchObject({
    state: 'REWORK',
    attempt: 2,
    submission: null,
    payment: null,
    punchList: [{ field: 'signed_tests_changed', reason: 'The signed tests were changed.' }],
    currentClaim: { builderId: 'builder' },
  });
  const room = await (await request('/yard/v1/blueprints/p/room')).json();
  expect(room.orders[0]).toMatchObject({
    state: 'REWORK',
    attempt: 2,
    punchList: [{ field: 'signed_tests_changed' }],
    refusals: [{ packageId: 'package-1', reference: 'void-1' }],
  });
  expect((await (await request('/yard/v1/board')).json()).orders).toHaveLength(0);
  let v = await version();
  const fixed = { commit: 'e'.repeat(40) };
  // Rework must rebuild first; a submission straight from REWORK conflicts and reserves nothing.
  expect((await request(`${base}/submit`, 'POST', fixed, v, 'submit-early', 'builder')).status).toBe(409);
  expect(await version()).toBe(v);
  // The voided hold does not carry over: rework waits for Stood's fresh hold.
  expect((await request(`${base}/build`, 'POST', {}, v, 'rebuild-early', 'builder')).status).toBe(409);
  await confirmHold(board, 'p', 'one', now);
  v = await version();
  expect((await request(`${base}/build`, 'POST', {}, v, 'rebuild', 'builder')).status).toBe(200);
  expect((await request(`${base}/submit`, 'POST', fixed, v + 1, 'submit-2', 'builder')).status).toBe(200);
  expect(await (await request(base)).json()).toMatchObject({
    state: 'CHECKING',
    submission: { packageId: 'package-2', commit: 'e'.repeat(40) },
    punchList: [{ field: 'signed_tests_changed' }],
  });
  // A replay of the first refusal can never touch the second package.
  expect((await webhook({ ...refused, id: 'refusal-replay' })).status).toBe(422);
  state.proof = {
    trancheId: 'tranche',
    packageId: 'package-2',
    reference: 'capture-2',
    effect: 'CAPTURE',
    minor: 1000,
    currency: 'USD',
    simulated: true,
  };
  const released = {
    ...refused,
    id: 'release-2',
    type: 'stood.released',
    packageId: 'package-2',
    reference: 'capture-2',
  };
  expect((await webhook(released)).status).toBe(200);
  expect(await (await request(base)).json()).toMatchObject({
    state: 'PAID',
    payment: { packageId: 'package-2', reference: 'capture-2' },
    punchList: null,
  });
});

it('closes the work order when Stood has no resubmissions left, and never reposts it (T-0189)', async () => {
  const { state, request, webhook, version, base, setup, refused } = harness();
  await setup();
  state.proof = { ...state.proof, resubmissionsLeft: 0 } as StoodProof;
  expect((await webhook(refused)).status).toBe(200);
  expect(await (await request(base)).json()).toMatchObject({ state: 'REFUSED', payment: null, currentClaim: null });
  const v = await version();
  expect((await request(`${base}/build`, 'POST', {}, v, 'rebuild', 'builder')).status).toBe(409);
  expect((await request(`${base}/repost`, 'POST', {}, v, 'repost')).status).toBe(409);
  expect((await request(`${base}/claim`, 'POST', {}, v, 'claim-2', 'builder')).status).toBe(409);
  expect((await (await request('/yard/v1/board')).json()).orders).toHaveLength(0);
});

it('lets a refused builder clock out of rework so the buyer can repost the same milestone', async () => {
  const { request, webhook, version, base, setup, refused } = harness();
  await setup();
  expect((await webhook(refused)).status).toBe(200);
  let v = await version();
  expect((await request(`${base}/release`, 'POST', {}, v, 'out', 'builder')).status).toBe(200);
  v = await version();
  expect((await request(`${base}/repost`, 'POST', {}, v, 'repost')).status).toBe(200);
  expect(await (await request(base)).json()).toMatchObject({ state: 'POSTED', attempt: 2, currentClaim: null });
  expect((await (await request('/yard/v1/board')).json()).orders).toHaveLength(1);
});
