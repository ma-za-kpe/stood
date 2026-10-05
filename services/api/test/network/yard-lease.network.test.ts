import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';

// Metadata lifecycle only: funding/hold cancellation remains a separate qualified path.
it('Yard network: lease expires, owner reposts, and a new claim gets a fresh identity', async () => {
  const clock = async () =>
    Number(
      (
        await (
          await fetch('http://paypal-sim:8080/__sim/time', { headers: { Authorization: 'Bearer sim-access-token' } })
        ).json()
      ).now,
    );
  const request = async (
    path: string,
    method = 'GET',
    body?: unknown,
    version = 1,
    key = 'request',
    role = 'buyer',
  ) => {
    const raw = body === undefined ? '' : JSON.stringify(body),
      t = String(Math.floor((await clock()) / 1000));
    return fetch(`http://yard-api:3001${path}`, {
      method,
      ...(raw ? { body: raw } : {}),
      headers: {
        'Yard-Key-Id': `sim-${role}-key`,
        'Yard-Signature': `t=${t},v1=${createHmac('sha256', `sim-${role}-secret`).update(`${t}.${method}.${path}.${raw}`).digest('hex')}`,
        'If-Match': String(version),
        'Idempotency-Key': key,
      },
      signal: AbortSignal.timeout(10000),
    });
  };
  const at = await clock(),
    id = 'yard-lease',
    path = `/yard/v1/blueprints/${id}`,
    wo = `${path}/work-orders/build`;
  const milestones = ['build', 'handover'].map((id, i) => ({
    id,
    name: id,
    budgetMinor: 1000,
    deadline: at + 7 * 86400000,
    profileId: i === 1 ? 'code.final@1' : 'code.milestone@1',
    testBundleHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    testIds: ['works'],
  }));
  expect(
    (
      await request(
        '/yard/v1/blueprints',
        'POST',
        {
          id,
          buyerOperatorId: 'buyer',
          repository: 'buyer/project',
          baseCommit: 'a'.repeat(40),
          summary: 'Lease lifecycle simulation',
          capMinor: 2000,
          currency: 'USD',
          milestones,
        },
        1,
        'create-lease',
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await request(
        `${path}/approve`,
        'POST',
        {
          version: 1,
          buyerOperatorId: 'buyer',
          approvalReference: 'sim-terms',
          baselines: milestones.map((m) => ({
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
    (
      await request(
        `${path}/work-orders`,
        'POST',
        { milestone: 'build', trancheId: 'unfunded-metadata-only' },
        2,
        'post',
      )
    ).status,
  ).toBe(200);
  expect((await request(`${wo}/claim`, 'POST', {}, 3, 'claim-first', 'builder')).status).toBe(200);
  const before = await (await request(wo)).json();
  expect(before.payment).toBeNull();
  expect((await request(`${wo}/expire`, 'POST', {}, 4, 'too-early')).status).toBe(409);
  const advance = await fetch('http://paypal-sim:8080/__sim/advance', {
    method: 'POST',
    headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ milliseconds: 48 * 3600000 }),
  });
  expect(advance.ok).toBe(true);
  expect((await request(`${wo}/expire`, 'POST', {}, 4, 'expire')).status).toBe(200);
  expect((await request(`${path}`, 'GET', undefined, 1, 'read', 'builder')).status).toBe(403);
  expect((await request(`${wo}/repost`, 'POST', {}, 5, 'repost')).status).toBe(200);
  const offers = await (await request('/yard/v1/board')).json();
  expect(offers.orders.find((o: { projectId: string }) => o.projectId === id)).toMatchObject({
    workOrderId: 'build',
    simulated: true,
  });
  expect((await request(`${wo}/claim`, 'POST', {}, 6, 'claim-second', 'builder')).status).toBe(200);
  const after = await (await request(wo)).json();
  expect(after.currentClaim.id).not.toBe(before.currentClaim.id);
  expect(after.currentClaim.leasedUntil).toBe((await clock()) + 48 * 3600000);
  expect(after.claims.map((c: { status: string }) => c.status)).toEqual(['EXPIRED', 'ACTIVE']);
  expect(after.payment).toBeNull();
});
