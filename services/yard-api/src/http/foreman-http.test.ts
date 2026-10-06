import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { Foreman, type PlannerModel } from '../../../yard-foreman/src/foreman.js';
import { MemorySaver } from '../../../yard-foreman/test/fakes/checkpoint.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from '../application/board.js';
import { createYardApp } from './app.js';

const at = 1791158400000;
const fixture = () => {
  let now = at;
  const model = {
    draft: vi.fn(async ({ intake }: Parameters<PlannerModel['draft']>[0]) => ({
      summary: 'A booking app',
      risks: ['Provider integrations are simulated'],
      requirements: [{ id: 'booking', text: 'A buyer can book', testIds: ['book'] }],
      milestones: ['Build', 'Preview', 'Handover'].map((name, i) => ({
        id: `m${i}`,
        name,
        budgetMinor: 1000,
        deadline: intake.createdAt + 7 * 86400000,
        tests: [{ id: 'book', path: 'tests/book.test.ts', content: 'expect(await book()).toBe(true);' }],
      })),
    })),
  };
  const foreman = new Foreman(model, new MemorySaver());
  const app = createYardApp({
    environment: 'ci',
    board: {
      board: new Board(new MemoryEvents()),
      clock: async () => now,
      foreman,
      operators: ['buyer', 'foreign', 'builder'].map((id) => ({
        key: `${id}-key`,
        secret: `${id}-secret`,
        actor: {
          id,
          root: `${id}-root`,
          kind: id === 'builder' ? ('BUILDER' as const) : ('BUYER' as const),
        },
      })),
    },
  });
  const request = (path: string, method = 'GET', input?: unknown, version = 1, actor = 'buyer') => {
    const raw = input === undefined ? '' : JSON.stringify(input),
      t = String(Math.floor(now / 1000));
    return app.request(path, {
      method,
      ...(raw ? { body: raw } : {}),
      headers: {
        'Yard-Key-Id': `${actor}-key`,
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', `${actor}-secret`)
          .update(
            JSON.stringify([
              'yard.request@2',
              t,
              `${actor}-key`,
              method,
              path,
              'test-request',
              String(version),
              'application/json',
              '',
              raw,
            ]),
          )
          .digest('hex')}`,
        'Content-Type': 'application/json',
        'If-Match': String(version),
        'Idempotency-Key': 'test-request',
      },
    });
  };
  const input = {
    id: 'plan',
    repository: 'buyer/project',
    baseCommit: 'a'.repeat(40),
    description: 'Build a booking app',
    capMinor: 3000,
    currency: 'USD',
  };
  return {
    app,
    request,
    model,
    foreman,
    input,
    advance: () => {
      now += 1000;
    },
  };
};
it('exposes owner-scoped draft and buyer review through signed HTTP without posting work or signing a mandate', async () => {
  const f = fixture();
  expect((await f.app.request('/yard/v1/plans')).status).toBe(401);
  const response = await f.request('/yard/v1/plans', 'POST', f.input);
  expect(response.status).toBe(201);
  const plan = await response.json();
  expect(plan).toMatchObject({
    status: 'BUYER_REVIEW',
    version: 1,
    simulated: true,
    blueprint: { buyerOperatorId: 'buyer', status: 'DRAFT', createdAt: at },
  });
  f.advance();
  expect(await (await f.request('/yard/v1/plans', 'POST', f.input)).json()).toEqual(plan);
  expect(f.model.draft).toHaveBeenCalledTimes(1);
  expect((await f.request('/yard/v1/plans/plan', 'GET', undefined, 1, 'foreign')).status).toBe(403);
  expect((await f.request('/yard/v1/plans/plan', 'GET', undefined, 1, 'builder')).status).toBe(403);
  expect((await f.request('/yard/v1/plans/plan/review', 'POST', { decision: 'REVISE' })).status).toBe(200);
  const revision = await f.request('/yard/v1/plans/plan/revisions', 'POST', { feedback: 'Add reminders' });
  expect(revision.status).toBe(200);
  expect(await revision.json()).toMatchObject({ status: 'BUYER_REVIEW', version: 2, blueprint: { status: 'DRAFT' } });
  expect((await f.request('/yard/v1/plans/plan/review', 'POST', { decision: 'ACCEPT' }, 1)).status).toBe(409);
  expect(await (await f.request('/yard/v1/plans/plan/review', 'POST', { decision: 'ACCEPT' }, 2)).json()).toMatchObject(
    { status: 'READY_FOR_BASELINE', blueprint: { status: 'DRAFT' } },
  );
  expect(await (await f.request('/yard/v1/board')).json()).toMatchObject({ orders: [] });
  expect((await (await f.app.request('/health')).json()).capabilities).toMatchObject({
    foreman: true,
    payments: false,
  });
});
it('rejects forged owner/time/authority fields and unsafe draft inputs before the model runs', async () => {
  const f = fixture();
  for (const patch of [
    { buyerOperatorId: 'foreign' },
    { createdAt: 0 },
    { paid: true },
    { currency: 'GHS' },
    { capMinor: -1 },
  ])
    expect((await f.request('/yard/v1/plans', 'POST', { ...f.input, ...patch })).status).toBe(422);
  expect((await f.request('/yard/v1/plans', 'POST', f.input, 1, 'builder')).status).toBe(403);
  expect(f.model.draft).not.toHaveBeenCalled();
});
it('sanitises model failures and recovers only for the original buyer', async () => {
  const f = fixture();
  f.model.draft.mockRejectedValueOnce(new Error('never print a provider secret'));
  const failed = await f.request('/yard/v1/plans', 'POST', f.input);
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('provider secret');
  expect((await f.request('/yard/v1/plans/plan/recover', 'POST', {}, 1, 'foreign')).status).toBe(403);
  const recovered = await f.request('/yard/v1/plans/plan/recover', 'POST', {});
  expect(recovered.status).toBe(200);
  expect(await recovered.json()).toMatchObject({ status: 'BUYER_REVIEW', version: 1 });
});

it('treats malformed planner output as unavailable rather than a buyer input error', async () => {
  const f = fixture();
  f.model.draft.mockResolvedValueOnce({ paid: true } as never);
  const response = await f.request('/yard/v1/plans', 'POST', f.input);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ code: 'yard_unavailable' });
  await expect(f.foreman.read('plan')).rejects.toThrow('NOT_FOUND');
});
