import { Hono } from 'hono';
import { expect, it } from 'vitest';
import { browserSession } from './fakes/browser-session.js';

it('keeps mock signing keys on the server, scopes cookies and forbids payment/provider proxying', async () => {
  const app = new Hono();
  app.get('/yard/v1/board', (c) =>
    c.json({ authenticated: !!c.req.header('Yard-Signature'), actorKey: c.req.header('Yard-Key-Id') }),
  );
  browserSession(app, async () => 1791158400000);
  expect((await app.request('/app/api/board')).status).toBe(401);
  const session = await app.request('/app/api/demo/session', {
    method: 'POST',
    body: JSON.stringify({ role: 'buyer' }),
  });
  expect(session.status).toBe(200);
  const cookie = session.headers.get('Set-Cookie')!;
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Strict');
  expect(await session.text()).not.toContain('secret');
  expect(await (await app.request('/app/api/board', { headers: { Cookie: cookie } })).json()).toMatchObject({
    authenticated: true,
    actorKey: 'sim-buyer-key',
  });
  for (const path of ['/app/api/payments', '/app/api/webhooks/stood', '/app/api/__mock/proof'])
    expect((await app.request(path, { headers: { Cookie: cookie } })).status).toBe(403);
});
