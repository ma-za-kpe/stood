import { createHmac } from 'node:crypto';
import { Hono } from 'hono';
import { expect, it } from 'vitest';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from '../application/board.js';
import { DemoError } from '../application/demo-autopilot.js';
import { createYardApp } from './app.js';
import { signedYardCall } from './demo-http.js';

const code = 'buyer-access-code-xxxxxxxxxxxxxxxx';
const origin = { Origin: 'https://stood-yard-api.onrender.com', 'Content-Type': 'application/json' };
function hosted(kind: 'BUYER' | 'BUILDER', start: () => unknown) {
  const app = createYardApp({
    environment: 'demo',
    board: {
      board: new Board(new MemoryEvents()),
      clock: async () => 1791158400000,
      operators: [{ key: 'k1', secret: 's'.repeat(40), accessCode: code, actor: { id: 'buyer', root: 'r', kind } }],
    },
    browser: {
      origin: 'https://stood-yard-api.onrender.com',
      demo: { start, status: (actor) => ({ runId: 'r1', buyer: actor.id }) },
    },
  });
  return app;
}
const session = async (app: Hono) => {
  const r = await app.request('/app/api/session', {
    method: 'POST',
    headers: { ...origin, 'X-Forwarded-For': '203.0.113.9' },
    body: JSON.stringify({ access_code: code }),
  });
  return { Cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] as string, ...origin };
};

it('lets only a signed-in buyer start the demo and read its progress, and maps busy and daily limits', async () => {
  let failure: string | null = null;
  const app = hosted('BUYER', () => {
    if (failure) throw new DemoError(failure);
    return { runId: 'r1' };
  });
  expect(await (await app.request('/app/api/capabilities')).json()).toMatchObject({ demo: true });
  expect((await app.request('/app/api/demo/build')).status).toBe(401);
  expect((await app.request('/app/api/demo/build', { method: 'POST', headers: origin })).status).toBe(401);
  const headers = await session(app);
  expect(await (await app.request('/app/api/demo/build', { headers })).json()).toEqual({
    run: { runId: 'r1', buyer: 'buyer' },
    available: true,
  });
  const started = await app.request('/app/api/demo/build', { method: 'POST', headers });
  expect(started.status).toBe(202);
  for (const [reason, status] of [
    ['BUSY', 409],
    ['DAILY_LIMIT', 429],
    ['FORBIDDEN', 403],
  ] as const) {
    failure = reason;
    expect((await app.request('/app/api/demo/build', { method: 'POST', headers })).status).toBe(status);
  }
});

it('refuses the demo to a builder session', async () => {
  const app = hosted('BUILDER', () => ({}));
  const headers = await session(app);
  expect((await app.request('/app/api/demo/build', { headers })).status).toBe(403);
  expect((await app.request('/app/api/demo/build', { method: 'POST', headers })).status).toBe(403);
});

it('signs each in-process call exactly as an operator client would, and reports refusals', async () => {
  const target = new Hono();
  const seen: Record<string, string>[] = [];
  target.all('/yard/v1/*', async (c) => {
    const body = c.req.method === 'GET' ? '' : await c.req.text();
    const [t, v2] = (c.req.header('Yard-Signature') ?? '').replace('t=', '').split(',v2=');
    const expected = createHmac('sha256', 'crew-secret')
      .update(
        JSON.stringify([
          'yard.request@2',
          t,
          'crew-key',
          c.req.method,
          new URL(c.req.url).pathname,
          c.req.header('Idempotency-Key') ?? '',
          c.req.header('If-Match') ?? '',
          'application/json',
          '',
          body,
        ]),
      )
      .digest('hex');
    seen.push({ key: c.req.header('Yard-Key-Id') ?? '', valid: String(v2 === expected) });
    return c.req.path.endsWith('/refuse') ? c.json({ code: 'conflict' }, 409) : c.json({ ok: true });
  });
  let ready: Hono | null = null;
  const call = signedYardCall(
    () => ready,
    { buyer: { key: 'buyer-key', secret: 'buyer-secret' }, crew: { key: 'crew-key', secret: 'crew-secret' } },
    () => 1791158400000,
  );
  await expect(call('crew', 'GET', '/blueprints/p')).rejects.toThrow('not ready');
  ready = target;
  expect(await call('crew', 'POST', '/blueprints/p/work-orders/a/claim', {}, 3, 'run:claim')).toEqual({ ok: true });
  expect(seen).toEqual([{ key: 'crew-key', valid: 'true' }]);
  await expect(call('buyer', 'POST', '/blueprints/p/refuse', {}, 1, 'k')).rejects.toThrow('HTTP 409 conflict');
  await expect(call('buyer', 'GET', '/blueprints/p')).resolves.toEqual({ ok: true });
});
