import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import { SiteLog } from '../application/site-log.js';
import type { LogEntry, SiteLogs } from '../ports/site-log.js';
import { SiteLogError } from '../ports/site-log.js';
import { createYardApp } from './app.js';

async function fixture(configured = true) {
  const f = await claimedFixture();
  let lines: LogEntry[] = [];
  const append = vi.fn(async (input: Parameters<SiteLogs['append']>[0]) => {
    input.authorize(await f.store.load(f.id));
    lines = [
      ...lines,
      ...input.lines.map((line, i) => ({
        seq: lines.length + i + 1,
        actor: input.actor,
        at: new Date(input.now).toISOString(),
        line,
      })),
    ];
    return { version: lines.length, count: input.lines.length, accepted: true as const };
  });
  const close = vi.fn();
  const store: SiteLogs = {
    append,
    bounds: async () => ({ version: lines.length, retainedFrom: 1 }),
    snapshot: async () => ({ version: lines.length, retainedFrom: 1, lines, summary: null }),
    read: async (_p, _w, after) => lines.filter((e) => e.seq > after),
    subscribe: async () => close,
    archive: async () => 0,
  };
  const scanner = { safe: vi.fn(async () => true) };
  const app = createYardApp({
    environment: 'ci',
    board: {
      board: f.board,
      clock: async () => leaseAt,
      operators: [leaseBuyer, leaseBuilder, { ...leaseBuilder, id: 'foreign' }].map((actor) => ({
        key: actor.id,
        secret: `${actor.id}-secret`,
        actor,
      })),
      ...(configured ? { siteLog: new SiteLog(store, f.board, scanner) } : {}),
    },
  });
  const path = `/yard/v1/blueprints/${f.id}/work-orders/one/log`;
  const request = (target = path, method = 'GET', body?: unknown, actor = 'builder', key = 'log-write') => {
    const raw = body === undefined ? '' : JSON.stringify(body),
      t = String(leaseAt / 1000);
    return app.request(target, {
      method,
      ...(raw ? { body: raw } : {}),
      headers: {
        'Yard-Key-Id': actor,
        'Content-Type': 'application/json',
        'Idempotency-Key': key,
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', `${actor}-secret`)
          .update(JSON.stringify(['yard.request@2', t, actor, method, target, key, '', 'application/json', '', raw]))
          .digest('hex')}`,
      },
    });
  };
  return { ...f, app, request, path, store, scanner, close, append };
}
it('serves private display-only progress and its own replay sequence through signed HTTP', async () => {
  const f = await fixture();
  const before = await f.board.events.load(f.id);
  expect((await f.request(f.path, 'POST', { lines: [{ kind: 'note', message: 'Building bookings' }] })).status).toBe(
    201,
  );
  const snapshot = await f.request(f.path, 'GET', undefined, 'buyer');
  expect(snapshot.headers.get('cache-control')).toBe('private, no-store');
  expect(await snapshot.json()).toMatchObject({
    version: 1,
    lines: [{ seq: 1, line: { message: 'Building bookings' } }],
  });
  const stream = await f.request(`${f.path}/events?since=0`, 'GET', undefined, 'buyer');
  const reader = stream.body!.getReader();
  let text = '';
  while (!text.includes('site_log.line')) text += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  expect(text).toContain('id: 1');
  expect(text).toContain('Building bookings');
  expect(f.close).toHaveBeenCalled();
  expect((await f.request(`${f.path}/events?since=2`)).status).toBe(409);
  expect((await f.request(`${f.path}/events?since=oops`)).status).toBe(400);
  expect(await f.board.events.load(f.id)).toEqual(before);
});
it('refuses foreign access, malformed commands, secret-bearing progress and unavailable scanners', async () => {
  const f = await fixture();
  expect((await f.app.request(f.path)).status).toBe(401);
  for (const suffix of ['', '/events'])
    expect((await f.request(`${f.path}${suffix}`, 'GET', undefined, 'foreign')).status).toBe(suffix ? 401 : 403);
  expect((await f.request(f.path, 'POST', { lines: [] })).status).toBe(422);
  expect(
    (await f.request(f.path, 'POST', { lines: [{ kind: 'note', message: 'client_secret = synthetic-secret-value' }] }))
      .status,
  ).toBe(422);
  expect((await f.request(f.path, 'POST', { lines: [{ kind: 'note', message: 'Build' }] }, 'builder', '')).status).toBe(
    422,
  );
  expect(f.scanner.safe).not.toHaveBeenCalled();
  f.scanner.safe.mockRejectedValue(new Error('secret scanner diagnostic'));
  const failed = await f.request(f.path, 'POST', { lines: [{ kind: 'note', message: 'Build' }] });
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ code: 'SCAN_UNAVAILABLE' });
  expect(f.append).not.toHaveBeenCalled();
});
it('maps rate limiting explicitly and never installs an unconfigured log', async () => {
  const f = await fixture();
  f.append.mockRejectedValue(new SiteLogError('RATE_LIMITED'));
  expect((await f.request(f.path, 'POST', { lines: [{ kind: 'note', message: 'Build' }] })).status).toBe(429);
  const disabled = await fixture(false);
  expect((await disabled.request()).status).toBe(503);
  expect(await (await disabled.request()).json()).toMatchObject({ code: 'not_implemented' });
});

it('replays retained history outside the latest display window', async () => {
  const f = await fixture();
  Object.assign(f.store, {
    snapshot: async () => ({ version: 300, retainedFrom: 101, lines: [], summary: null }),
    bounds: async () => ({ version: 300, retainedFrom: 1 }),
  });
  const response = await f.request(`${f.path}/events?since=0`);
  try {
    expect(response.status).toBe(200);
  } finally {
    await response.body?.cancel();
  }
});
