import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { intakeFixture } from '../../../../packages/yard-contracts/test/fakes/intake.js';

it('Yard network: private resumable autosave with metadata-only events and no credential intake', async () => {
  const clock = await fetch('http://paypal-sim:8080/__sim/time', {
    headers: { Authorization: 'Bearer sim-access-token' },
  });
  const { now } = (await clock.json()) as { now: number };
  const request = (path: string, method = 'GET', value?: unknown, version = 0, key = 'save', role = 'buyer') => {
    const raw = value === undefined ? '' : JSON.stringify(value),
      t = String(Math.floor(now / 1000));
    return fetch(`http://yard-api:3001${path}`, {
      method,
      ...(raw ? { body: raw } : {}),
      headers: {
        'Yard-Key-Id': `sim-${role}-key`,
        'If-Match': String(version),
        'Idempotency-Key': key,
        'Content-Type': 'application/json',
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', `sim-${role}-secret`)
          .update(
            JSON.stringify([
              'yard.request@2',
              t,
              `sim-${role}-key`,
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
      },
      signal: AbortSignal.timeout(10000),
    });
  };
  const id = 'yard-intake',
    path = `/yard/v1/intakes/${id}`;
  const draft = {
    idea: { description: 'Private appointment workflow' },
    services: { decide: false, selected: [{ category: 'DATABASE', provider: 'Supabase' }] },
  };
  const initial = await request('/yard/v1/intakes', 'POST', { id, step: 0, draft });
  expect(initial.status).toBe(201);
  const first = await initial.json();
  expect(first).toMatchObject({ id, owner: 'buyer', version: 1, createdAt: now, updatedAt: now, draft });
  expect((await request(path, 'GET', undefined, 0, 'read', 'builder')).status).toBe(403);
  const next = { ...draft, audience: { offline: 'YES' } };
  expect((await request(path, 'PUT', { step: 1, draft: next }, 1, 'second')).status).toBe(200);
  expect((await request(path, 'PUT', { step: 2, draft: next }, 1, 'stale')).status).toBe(409);
  expect(await (await request(path)).json()).toMatchObject({ version: 2, step: 1, draft: next });
  expect(await (await request('/yard/v1/intakes', 'POST', { id, step: 0, draft })).json()).toEqual(first);
  const rejected = await request(
    path,
    'PUT',
    { step: 2, draft: { idea: { description: 'client_secret = synthetic-secret-value' } } },
    2,
    'secret',
  );
  expect(rejected.status).toBe(422);
  expect(await rejected.json()).toEqual({ code: 'CREDENTIAL_IN_INTAKE' });
  expect(await (await request(path)).json()).toMatchObject({ version: 2, draft: next });
  const stream = await request(`${path}/events?since=0`),
    reader = stream.body!.getReader();
  expect(stream.status).toBe(200);
  let events = '';
  for (let i = 0; i < 10 && !events.includes('"seq":2'); i++)
    events += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  expect(events).toContain('event: intake.saved');
  expect(events).toContain('"seq":2');
  expect(events).not.toContain(draft.idea.description);
  expect(events).not.toContain('Supabase');
  const complete = intakeFixture(now);
  // Buyers supply a repository, never a trusted commit identity.
  const { baseCommit: _untrusted, ...handover } = complete.handover;
  expect((await request(path, 'PUT', { step: 7, draft: { ...complete, handover } }, 2, 'complete')).status).toBe(200);
  const planned = await request(`${path}/plan`, 'POST', {}, 3, 'plan');
  expect(planned.status).toBe(201);
  const plan = await planned.json();
  expect(plan).toMatchObject({ status: 'BUYER_REVIEW', simulated: true, version: 1 });
  expect(JSON.parse(plan.intakeContext)).toMatchObject({
    idea: complete.idea,
    timing: complete.timing,
    handover: { repository: 'buyer/project' },
  });
  expect(plan.blueprint.baseCommit).toMatch(/^[a-f0-9]{40}$/);
  expect(await (await request(`${path}/plan`, 'POST', {}, 3, 'plan-retry')).json()).toEqual(plan);
  expect((await request(`${path}/plan`, 'POST', {}, 2, 'stale-plan')).status).toBe(409);
  expect((await request(`${path}/plan`, 'POST', {}, 3, 'builder-plan', 'builder')).status).toBe(403);
  const health = await (await fetch('http://yard-api:3001/health')).json();
  expect(health.capabilities).toMatchObject({ intake: true, credentials: false, payments: false });
});
