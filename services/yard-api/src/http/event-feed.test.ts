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

it('stops before replay if ownership or key access changes after opening', async () => {
  let allowed = true;
  const read = vi.fn(async () => []),
    release = vi.fn();
  const app = createYardApp({
    environment: 'ci',
    eventFeed: {
      store: {
        load: async () => {
          allowed = false;
          return { version: 1 };
        },
        read,
        subscribe: async () => release,
      },
      authorize: async () => allowed,
    },
  });
  const response = await app.request('/yard/v1/blueprints/p/events');
  expect(await response.text()).toContain('event: authorization.required');
  expect(read).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});
it('never publishes a private batch if access is lost while reading it', async () => {
  let allowed = true;
  const release = vi.fn();
  const app = createYardApp({
    environment: 'ci',
    eventFeed: {
      store: {
        load: async () => ({ version: 1 }),
        read: async () => {
          allowed = false;
          return [
            {
              seq: 1,
              type: 'wo.claimed',
              actor: 'builder',
              payload: { private: 'private-repository' },
              at: '2026-10-05T00:00:00Z',
            },
          ];
        },
        subscribe: async () => release,
      },
      authorize: async () => allowed,
    },
  });
  const response = await app.request('/yard/v1/blueprints/p/events');
  const text = await response.text();
  expect(text).toContain('event: authorization.required');
  expect(text).not.toContain('private-repository');
  expect(text).not.toContain('event: wo.claimed');
  expect(release).toHaveBeenCalledOnce();
});
it('rechecks access before each event rather than granting an entire batch', async () => {
  let checks = 0;
  const authorize = vi.fn(async () => ++checks < 5);
  const app = createYardApp({
    environment: 'ci',
    eventFeed: {
      store: {
        load: async () => ({ version: 2 }),
        read: async () =>
          [1, 2].map((seq) => ({
            seq,
            type: 'wo.claimed',
            actor: 'builder',
            payload: { private: `private-${seq}` },
            at: '2026-10-05T00:00:00Z',
          })),
      },
      authorize,
    },
  });
  const text = await (await app.request('/yard/v1/blueprints/p/events')).text();
  expect(text).toContain('private-1');
  expect(text).not.toContain('private-2');
  expect(text).toContain('event: authorization.required');
});

it('closes with a value-free reauthentication event if the access check becomes unavailable', async () => {
  let calls = 0;
  const read = vi.fn(async () => []),
    release = vi.fn();
  const app = createYardApp({
    environment: 'ci',
    eventFeed: {
      store: { load: async () => ({ version: 0 }), read, subscribe: async () => release },
      authorize: async () => {
        if (++calls > 1) throw new Error('private authorization backend detail');
        return true;
      },
    },
  });
  const text = await (await app.request('/yard/v1/blueprints/p/events')).text();
  expect(text).toContain('event: authorization.required');
  expect(text).not.toContain('private authorization backend detail');
  expect(read).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledOnce();
});

it('refreshes an open log when retention advances without a new event', async () => {
  let loads = 0;
  const app = createYardApp({
    environment: 'ci',
    eventFeed: {
      store: {
        load: async () => ({ version: 1, retainedFrom: ++loads === 1 ? 1 : 2 }),
        read: async () => [],
      },
      authorize: async () => true,
    },
  });
  const response = await app.request('/yard/v1/blueprints/p/events?since=1');
  const reader = response.body!.getReader();
  try {
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: snapshot.required');
  } finally {
    await reader.cancel();
  }
});
