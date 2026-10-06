import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from '../application/board.js';
import type { IntakeRecord } from '../ports/intakes.js';
import { createYardApp } from './app.js';

const now = 1791158400000;
function fixture() {
  const saved: IntakeRecord = {
    id: 'idea',
    owner: 'buyer',
    version: 1,
    step: 0,
    draft: { idea: { description: 'Build bookings' } },
    createdAt: now,
    updatedAt: now,
  };
  const store = { load: vi.fn(async () => saved), read: vi.fn(async () => []), save: vi.fn(async () => saved) };
  const app = createYardApp({
    environment: 'ci',
    board: {
      board: new Board(new MemoryEvents()),
      clock: async () => now,
      intakes: store,
      operators: ['buyer', 'foreign', 'builder'].map((id) => ({
        key: `${id}-key`,
        secret: `${id}-secret`,
        actor: { id, root: `${id}-root`, kind: id === 'builder' ? ('BUILDER' as const) : ('BUYER' as const) },
      })),
    },
  });
  const request = (path: string, method = 'GET', value?: unknown, version = '0', actor = 'buyer') => {
    const body = value === undefined ? '' : JSON.stringify(value),
      t = String(now / 1000),
      key = 'save';
    const headers = {
      'Yard-Key-Id': `${actor}-key`,
      'If-Match': version,
      'Idempotency-Key': key,
      'Content-Type': 'application/json',
      'Yard-Signature': `t=${t},v2=${createHmac('sha256', `${actor}-secret`)
        .update(
          JSON.stringify([
            'yard.request@2',
            t,
            `${actor}-key`,
            method,
            path,
            key,
            version,
            'application/json',
            '',
            body,
          ]),
        )
        .digest('hex')}`,
    };
    return app.request(path, { method, headers, ...(body ? { body } : {}) });
  };
  return { store, app, request, saved };
}
it('owns autosave identity and clock on the server and returns a resumable private record', async () => {
  const { request, store, saved } = fixture();
  const response = await request('/yard/v1/intakes', 'POST', { id: 'idea', step: 0, draft: saved.draft });
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual(saved);
  expect(store.save).toHaveBeenCalledWith({
    id: 'idea',
    owner: 'buyer',
    key: 'save',
    expectedVersion: 0,
    step: 0,
    draft: saved.draft,
    now,
  });
  const resumed = await request('/yard/v1/intakes/idea');
  expect(resumed.status).toBe(200);
  expect(resumed.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await resumed.json()).toEqual(saved);
  expect((await request('/yard/v1/intakes/idea', 'PUT', { step: 1, draft: saved.draft }, '1')).status).toBe(200);
});
it('rejects unowned reads, builder writes and injected identity or credential fields', async () => {
  const { request, store, saved } = fixture();
  expect((await request('/yard/v1/intakes/idea', 'GET', undefined, '0', 'foreign')).status).toBe(403);
  expect(
    (await request('/yard/v1/intakes', 'POST', { id: 'idea', step: 0, draft: saved.draft }, '0', 'builder')).status,
  ).toBe(403);
  for (const value of [
    { id: 'idea', step: 0, draft: saved.draft, owner: 'foreign' },
    { id: 'idea', step: 0, draft: saved.draft, now: 0 },
    { id: 'idea', step: 8, draft: saved.draft },
    { id: 'idea', step: 0, draft: { services: { credentials: {} } } },
    { id: 'idea', step: 0, draft: { idea: { description: 'client_secret = synthetic-secret-value' } } },
  ])
    expect((await request('/yard/v1/intakes', 'POST', value)).status).toBe(422);
  expect(store.save).not.toHaveBeenCalled();
  expect((await request('/yard/v1/intakes/idea/events', 'GET', undefined, '0', 'foreign')).status).toBe(401);
  expect(store.read).not.toHaveBeenCalled();
});
it('rejects a missing version instead of confusing it with a new draft', async () => {
  const { request, store, saved } = fixture();
  expect((await request('/yard/v1/intakes', 'POST', { id: 'idea', step: 0, draft: saved.draft }, '')).status).toBe(422);
  expect((await request('/yard/v1/intakes/idea', 'PUT', { step: 0, draft: saved.draft }, '0')).status).toBe(422);
  expect(store.save).not.toHaveBeenCalled();
});
