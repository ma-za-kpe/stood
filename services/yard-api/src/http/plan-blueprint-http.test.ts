import { createHmac } from 'node:crypto';
import type { BaselineInput } from '@stood/stood-sdk';
import { expect, it, vi } from 'vitest';
import { Foreman } from '../../../yard-foreman/src/foreman.js';
import { MemorySaver } from '../../../yard-foreman/test/fakes/checkpoint.js';
import { MemoryEvents } from '../../test/fakes/events.js';
import { FakeRepositories } from '../../test/fakes/github.js';
import { Board } from '../application/board.js';
import { createYardApp } from './app.js';

const at = 1791158400000;
// C4 (#77): the buyer turns an accepted plan into a frozen blueprint over signed HTTP; Stood decides when it is red.
it('freezes an accepted plan only after Stood reports every frozen test red, and refuses anyone else', async () => {
  const repositories = new FakeRepositories(() => at, [{ id: '42', owner: 'buyer' }]);
  const { commit: base } = await repositories.create('42', 'project', { 'README.md': 'booking' });
  const model = {
    draft: vi.fn(async ({ intake }: { intake: { createdAt: number } }) => ({
      summary: 'A booking app',
      risks: [],
      requirements: [{ id: 'booking', text: 'A buyer can book', testIds: ['book0'] }],
      milestones: ['Build', 'Preview', 'Handover'].map((name, i) => ({
        id: `m${i}`,
        name,
        budgetMinor: 1000,
        deadline: intake.createdAt + 7 * 86400000,
        tests: [{ id: `book${i}`, path: `tests/book${i}.test.ts`, content: `expect(await book(${i})).toBe(true);` }],
      })),
    })),
  };
  let red = false;
  const stood = {
    requestBaseline: vi.fn(async (input: BaselineInput, key: string) => ({
      id: key.replaceAll(':', '_'),
      status: red ? ('DONE' as const) : ('QUEUED' as const),
      repository: input.repository,
      baseCommit: input.baseCommit,
      testBundleHash: input.testBundleHash,
      tests: red ? input.testIds.map((id) => ({ id, status: 'FAIL' as const })) : null,
      evidenceSha256: red ? 'e'.repeat(64) : null,
    })),
  };
  const app = createYardApp({
    environment: 'ci',
    board: {
      board: new Board(new MemoryEvents()),
      clock: async () => at,
      foreman: new Foreman(model as never, new MemorySaver()),
      planBlueprints: { repositories, installation: '42', stood },
      operators: ['buyer', 'foreign', 'builder'].map((id) => ({
        key: `${id}-key`,
        secret: `${id}-secret`,
        actor: { id, root: `${id}-root`, kind: id === 'builder' ? ('BUILDER' as const) : ('BUYER' as const) },
      })),
    },
  });
  const request = (path: string, input: unknown, version = 1, actor = 'buyer') => {
    const raw = JSON.stringify(input),
      t = String(Math.floor(at / 1000));
    return app.request(path, {
      method: 'POST',
      body: raw,
      headers: {
        'Yard-Key-Id': `${actor}-key`,
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', `${actor}-secret`)
          .update(
            JSON.stringify([
              'yard.request@2',
              t,
              `${actor}-key`,
              'POST',
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
    baseCommit: base,
    description: 'Build a booking app',
    capMinor: 3000,
    currency: 'USD',
  };
  expect((await request('/yard/v1/plans', input)).status).toBe(201);
  // Not yet accepted: nothing is seeded.
  expect((await request('/yard/v1/plans/plan/blueprint', {})).status).toBe(409);
  expect((await request('/yard/v1/plans/plan/review', { decision: 'ACCEPT' })).status).toBe(200);
  expect((await request('/yard/v1/plans/plan/blueprint', {}, 1, 'foreign')).status).toBe(403);
  expect((await request('/yard/v1/plans/plan/blueprint', {}, 1, 'builder')).status).toBe(403);
  expect((await request('/yard/v1/plans/plan/blueprint', { extra: true })).status).toBe(422);
  const running = await request('/yard/v1/plans/plan/blueprint', {});
  expect(running.status).toBe(200);
  expect(running.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await running.json()).toMatchObject({ blueprintId: 'plan', status: 'BASELINE_RUNNING' });
  red = true;
  expect(await (await request('/yard/v1/plans/plan/blueprint', {})).json()).toMatchObject({ status: 'FROZEN' });
  expect(stood.requestBaseline).toHaveBeenCalledWith(
    expect.objectContaining({ repository: 'buyer/project', testIds: ['book0'] }),
    'yard-baseline:plan:m0',
  );
});
