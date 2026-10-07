import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board, type StoodProof } from '../application/board.js';
import { createYardApp } from './app.js';

it('accepts a hold only from a signed notification plus a matching Stood read, then lets work start (T-0187)', async () => {
  const board = new Board(new MemoryEvents());
  const expiresAt = leaseAt + 29 * 86400000;
  let proof: StoodProof = { trancheId: 'tranche', effect: 'HOLD', expiresAt, simulated: true };
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => leaseAt,
      operators: [{ key: 'buyer-key', secret: 'buyer-secret', actor: leaseBuyer }],
      stood: { mode: 'sim', secret: 'sim-stood-webhook-secret', read: async () => proof },
    },
  });
  const webhook = (value: unknown, secret = 'sim-stood-webhook-secret') => {
    const raw = JSON.stringify(value),
      t = String(leaseAt / 1000);
    return app.request('/yard/v1/webhooks/stood', {
      method: 'POST',
      body: raw,
      headers: { 'Stood-Signature': `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` },
    });
  };
  const milestones = ['one', 'two'].map((id, i) => ({
    id,
    name: id,
    budgetMinor: 1000,
    deadline: leaseAt + 7 * 86400000,
    profileId: (i ? 'code.final@1' : 'code.milestone@1') as 'code.final@1' | 'code.milestone@1',
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
  await board.post('p', 'one', 'tranche', leaseBuyer, 2, 'post', leaseAt);
  const held = { id: 'held-1', type: 'stood.held', projectId: 'p', wo: 'one', trancheId: 'tranche', simulated: true };
  // Not claimed yet: nothing to hold for.
  expect((await webhook(held)).status).toBe(422);
  await board.claim('p', 'one', leaseBuilder, 3, 'claim', leaseAt);
  await expect(board.build('p', 'one', leaseBuilder, 4, 'early', leaseAt)).rejects.toThrow('CONFLICT');
  expect((await webhook(held, 'forged')).status).toBe(401);
  for (const bad of [
    { ...proof, trancheId: 'other' },
    { ...proof, effect: 'CAPTURE' },
    { ...proof, expiresAt: leaseAt - 1 },
  ]) {
    const saved: StoodProof = proof;
    proof = bad as StoodProof;
    expect((await webhook(held)).status).toBe(422);
    proof = saved;
  }
  expect((await webhook(held)).status).toBe(200);
  expect((await webhook(held)).status).toBe(200);
  expect((await board.view('p', 'one', leaseBuyer)).hold).toEqual({ expiresAt });
  expect((await board.room('p', leaseBuyer)).orders[0]).toMatchObject({ held: true });
  // A second hold for the same attempt is refused; the builder can now start.
  expect((await webhook({ ...held, id: 'held-2' })).status).toBe(422);
  await board.build('p', 'one', leaseBuilder, 5, 'build', leaseAt);
  // The builder holding the work sees the hold event in its filtered stream.
  const viewer = await board.viewer('p', leaseBuilder);
  expect(viewer.see({ seq: 4, type: 'stood.held', actor: 'stood', payload: { wo: 'one' }, at: '' })).toBe(true);
});
