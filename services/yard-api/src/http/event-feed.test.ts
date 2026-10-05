import { expect, it, vi } from 'vitest';
import type { YardEvents } from '../ports/events.js';
import { createYardApp } from './app.js';

it('authenticates project replay, validates resume positions, and signals a large gap', async () => {
  const read = vi.fn(async () => [
    { seq: 2, type: 'wo.claimed', actor: 'builder', payload: { wo: 'one' }, at: '2026-10-05T00:00:00Z' },
  ]);
  const store = {
    load: async () => ({ id: 'p', owner: 'buyer', version: 2, data: {} }),
    read,
  } as unknown as YardEvents;
  const app = createYardApp({
    environment: 'ci',
    eventFeed: {
      store,
      authorize: async (headers, id) => headers.get('Authorization') === 'Bearer test-only' && id === 'p',
    },
  });
  expect((await app.request('/yard/v1/blueprints/other/events')).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
  const headers = { Authorization: 'Bearer test-only', 'Last-Event-ID': '1' };
  const abort = new AbortController();
  const response = await app.request('/yard/v1/blueprints/p/events', { headers, signal: abort.signal });
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  expect(first).toContain('id: 2');
  expect(first).toContain('event: wo.claimed');
  abort.abort();
  await reader.cancel();
  expect(read).toHaveBeenCalledWith('p', 1);
  expect(
    (await app.request('/yard/v1/blueprints/p/events', { headers: { ...headers, 'Last-Event-ID': '-1' } })).status,
  ).toBe(400);
  expect(
    (await app.request('/yard/v1/blueprints/p/events', { headers: { ...headers, 'Last-Event-ID': '9' } })).status,
  ).toBe(409);
  read.mockResolvedValue(
    Array.from({ length: 501 }, (_, i) => ({
      seq: i + 1,
      type: 'wo.claimed',
      actor: 'builder',
      payload: { wo: 'one' },
      at: '2026-10-05T00:00:00Z',
    })),
  );
  const gap = await app.request('/yard/v1/blueprints/p/events', { headers: { Authorization: 'Bearer test-only' } });
  expect(await gap.text()).toContain('event: snapshot.required');
});
