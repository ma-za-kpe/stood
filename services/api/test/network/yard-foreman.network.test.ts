import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';

it('network Foreman: signed draft, owner review, revision and baseline wait without Board or money effects', async () => {
  const clock = await fetch('http://paypal-sim:8080/__sim/time', {
    headers: { Authorization: 'Bearer sim-access-token' },
  });
  const { now } = (await clock.json()) as { now: number };
  const request = (suffix: string, method = 'GET', input?: unknown, version = 1, role = 'buyer') => {
    const path = `/yard/v1${suffix}`,
      raw = input === undefined ? '' : JSON.stringify(input),
      t = String(Math.floor(now / 1000));
    return fetch(`http://yard-api:3001${path}`, {
      method,
      ...(raw ? { body: raw } : {}),
      headers: {
        'Yard-Key-Id': `sim-${role}-key`,
        'Yard-Signature': `t=${t},v1=${createHmac('sha256', `sim-${role}-secret`).update(`${t}.${method}.${path}.${raw}`).digest('hex')}`,
        'Idempotency-Key': 'planner-scenario',
        'If-Match': String(version),
      },
      signal: AbortSignal.timeout(10000),
    });
  };
  const input = {
    id: 'network-plan',
    repository: 'buyer/project',
    baseCommit: 'a'.repeat(40),
    description: 'Build a booking app',
    capMinor: 3000,
    currency: 'USD',
  };
  const before = await (await request('/board')).json();
  const draft = await request('/plans', 'POST', input);
  expect(draft.status).toBe(201);
  const plan = await draft.json();
  expect(plan).toMatchObject({
    status: 'BUYER_REVIEW',
    simulated: true,
    version: 1,
    blueprint: { status: 'DRAFT', createdAt: now, buyerOperatorId: 'buyer' },
  });
  expect(plan.risks).toContain('Scripted planner output. No AI provider was called.');
  expect((await request('/plans/network-plan', 'GET', undefined, 1, 'builder')).status).toBe(403);
  expect(await (await request('/plans/network-plan')).json()).toEqual(plan);
  expect((await request('/plans/network-plan/review', 'POST', { decision: 'REVISE' })).status).toBe(200);
  const revision = await request('/plans/network-plan/revisions', 'POST', { feedback: 'Include reminders' });
  expect(await revision.json()).toMatchObject({ version: 2, status: 'BUYER_REVIEW', simulated: true });
  const accepted = await request('/plans/network-plan/review', 'POST', { decision: 'ACCEPT' }, 2);
  expect(await accepted.json()).toMatchObject({
    version: 2,
    status: 'READY_FOR_BASELINE',
    blueprint: { status: 'DRAFT' },
  });
  expect(await (await request('/board')).json()).toEqual(before);
  expect((await (await fetch('http://yard-api:3001/health')).json()).capabilities).toMatchObject({
    foreman: true,
    payments: false,
  });
});
