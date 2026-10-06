import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';

const clock = async () =>
  Number(
    (
      await (
        await fetch('http://paypal-sim:8080/__sim/time', { headers: { Authorization: 'Bearer sim-access-token' } })
      ).json()
    ).now,
  );
const yard = async (path: string, method: string, value: unknown, version: number, key: string) => {
  const raw = JSON.stringify(value),
    t = String(Math.floor((await clock()) / 1000));
  return fetch(`http://yard-api:3001${path}`, {
    method,
    body: raw,
    headers: {
      'Yard-Key-Id': 'sim-buyer-key',
      'Yard-Signature': `t=${t},v2=${createHmac('sha256', 'sim-buyer-secret')
        .update(
          JSON.stringify([
            'yard.request@2',
            t,
            'sim-buyer-key',
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
      'Content-Type': 'application/json',
      'If-Match': String(version),
      'Idempotency-Key': key,
    },
    signal: AbortSignal.timeout(10000),
  });
};
it('Yard network: signed blueprint → real Stood allowance draft → milestones bound to Stood tranches (T-0184)', async () => {
  const at = await clock();
  const milestones = ['one', 'two'].map((id, i) => ({
    id,
    name: i ? 'Buyer uses the app' : 'Build the booking app',
    profileId: i ? 'code.final@1' : 'code.milestone@1',
    budgetMinor: 1000,
    deadline: at + 7 * 86400000,
    testBundleHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    testIds: ['booking-works'],
  }));
  const project = 'yard-mandate-project';
  const create = {
    id: project,
    buyerOperatorId: 'buyer',
    repository: 'buyer/project',
    baseCommit: 'a'.repeat(40),
    summary: 'Mandate example',
    capMinor: 2000,
    currency: 'USD',
    milestones,
  };
  expect((await yard('/yard/v1/blueprints', 'POST', create, 1, 'create')).status).toBe(201);
  const approval = {
    version: 1,
    buyerOperatorId: 'buyer',
    approvalReference: 'sim-approved-terms',
    baselines: milestones.map((m) => ({
      milestoneId: m.id,
      testBundleHash: m.testBundleHash,
      manifestHash: m.manifestHash,
      failedTestIds: m.testIds,
      reference: 'sim-red-baseline',
    })),
  };
  expect((await yard(`/yard/v1/blueprints/${project}/approve`, 'POST', approval, 1, 'freeze')).status).toBe(200);
  const mandate = await yard(`/yard/v1/blueprints/${project}/mandate`, 'POST', {}, 2, 'mandate');
  expect(mandate.status).toBe(200);
  const body = (await mandate.json()) as { allowanceId: string; tranches: Record<string, string>; status: string };
  expect(body.status).toBe('DRAFT');
  expect(Object.keys(body.tranches)).toEqual(['one', 'two']);
  expect(new Set(Object.values(body.tranches)).size).toBe(2);
  const post = await yard(`/yard/v1/blueprints/${project}/work-orders`, 'POST', { milestone: 'one' }, 4, 'post');
  expect(post.status).toBe(200);
  const forged = { milestone: 'two', trancheId: 'not-from-stood' };
  expect((await yard(`/yard/v1/blueprints/${project}/work-orders`, 'POST', forged, 5, 'forged')).status).toBe(422);
});
