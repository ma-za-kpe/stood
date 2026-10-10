import { expect, it } from 'vitest';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from '../application/board.js';
import { createYardApp } from './app.js';

const code = 'buyer-access-code-xxxxxxxxxxxxxxxx';
const secret = 's'.repeat(40);
function hosted() {
  let now = 1791158400000;
  const app = createYardApp({
    environment: 'demo',
    board: {
      board: new Board(new MemoryEvents()),
      clock: async () => now,
      operators: [
        { key: 'buyer-key', secret, accessCode: code, actor: { id: 'buyer', root: 'buyer-root', kind: 'BUYER' } },
      ],
    },
    browser: { origin: 'https://stood-yard-api.onrender.com' },
  });
  return { app, advance: (ms: number) => (now += ms) };
}
const origin = { Origin: 'https://stood-yard-api.onrender.com', 'Content-Type': 'application/json' };
const signIn = (app: ReturnType<typeof hosted>['app'], accessCode: string, ip = '203.0.113.1') =>
  app.request('/app/api/session', {
    method: 'POST',
    headers: { ...origin, 'X-Forwarded-For': ip },
    body: JSON.stringify({ access_code: accessCode }),
  });

// T-0266: the hosted Yard page signs people in with an access code the owner issues. The cookie is an opaque,
// expiring session id; the operator's signing secret never reaches the browser.
it('signs an operator in with an access code and proxies only the Board paths for that session', async () => {
  const { app } = hosted();
  expect(await (await app.request('/app/api/session')).json()).toEqual({ mode: 'hosted', role: null });
  expect((await app.request('/app/api/board')).status).toBe(401);
  expect((await signIn(app, 'wrong-code-wrong-code-wrong-code')).status).toBe(401);
  const ok = await signIn(app, code);
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ mode: 'hosted', role: 'buyer' });
  const cookie = ok.headers.get('set-cookie') ?? '';
  expect(cookie).toMatch(/^yard-session=[A-Za-z0-9_-]{43};/);
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/Secure/);
  expect(cookie).toMatch(/SameSite=Strict/);
  expect(cookie).toMatch(/Path=\/app\/api/);
  expect(cookie).not.toContain(code);
  expect(cookie).not.toContain(secret);
  const session = { Cookie: cookie.split(';')[0] ?? '' };
  expect(await (await app.request('/app/api/session', { headers: session })).json()).toEqual({
    mode: 'hosted',
    role: 'buyer',
  });
  expect((await app.request('/app/api/board', { headers: session })).status).toBe(200);
  expect((await app.request('/app/api/payments', { headers: session })).status).toBe(403);
  expect(
    (
      await app.request('/app/api/demo/session', {
        method: 'POST',
        headers: { ...session, ...origin },
        body: '{"role":"buyer"}',
      })
    ).status,
  ).toBe(403);
  // Changes must come from the page itself.
  const foreign = await app.request('/app/api/intakes', {
    method: 'POST',
    headers: { ...session, 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: '{}',
  });
  expect(foreign.status).toBe(403);
  const out = await app.request('/app/api/session', { method: 'DELETE', headers: { ...session, ...origin } });
  expect(out.status).toBe(200);
  expect((await app.request('/app/api/board', { headers: session })).status).toBe(401);
});

it('slows guessing and expires sessions', async () => {
  const { app, advance } = hosted();
  for (let i = 0; i < 10; i++) expect((await signIn(app, `guess-${i}-guess-guess-guess-guess`)).status).toBe(401);
  expect((await signIn(app, code)).status).toBe(429);
  expect((await signIn(app, code, '198.51.100.7')).status).toBe(200);
  advance(60_000);
  const ok = await signIn(app, code);
  expect(ok.status).toBe(200);
  const session = { Cookie: (ok.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  advance(8 * 3600_000 + 1);
  expect((await app.request('/app/api/board', { headers: session })).status).toBe(401);
});

it('prevents cached session disclosure and refuses retired operator credentials', async () => {
  let now = 1791158400000;
  const app = createYardApp({
    environment: 'demo',
    board: {
      board: new Board(new MemoryEvents()),
      clock: async () => now,
      operators: [
        {
          key: 'buyer-key',
          secret,
          accessCode: code,
          notAfter: now + 1000,
          actor: { id: 'buyer', root: 'buyer-root', kind: 'BUYER' },
        },
      ],
    },
    browser: { origin: 'https://stood-yard-api.onrender.com' },
  });
  const login = await signIn(app, code);
  expect(login.headers.get('cache-control')).toBe('private, no-store');
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  now += 1000;
  expect(await (await app.request('/app/api/session', { headers: { Cookie: cookie } })).json()).toEqual({
    mode: 'hosted',
    role: null,
  });
  expect((await signIn(app, code)).status).toBe(401);
});
