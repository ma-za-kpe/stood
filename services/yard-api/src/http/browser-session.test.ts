import { expect, it } from 'vitest';
import { MemoryEvents } from '../../test/fakes/events.js';
import { Board } from '../application/board.js';
import { createYardApp } from './app.js';

const code = 'buyer-access-code-xxxxxxxxxxxxxxxx';
const secret = 's'.repeat(40);
function hosted(
  foreman = false,
  agStudioLicense?: Readonly<{ key?: string; expiresAt?: string }>,
  actorKind: 'BUYER' | 'BUILDER' = 'BUYER',
) {
  let now = 1791158400000;
  const app = createYardApp({
    environment: 'demo',
    board: {
      board: new Board(new MemoryEvents()),
      clock: async () => now,
      ...(foreman ? { foreman: {} as never } : {}),
      operators: [
        {
          key: 'buyer-key',
          secret,
          accessCode: actorKind === 'BUYER' ? code : 'builder-access-code-xxxxxxxxx',
          actor: {
            id: actorKind === 'BUYER' ? 'buyer' : 'builder',
            root: `${actorKind.toLowerCase()}-root`,
            kind: actorKind,
          },
        },
      ],
    },
    browser: {
      origin: 'https://stood-yard-api.onrender.com',
      ...(agStudioLicense ? { agStudioLicense } : {}),
      ...(foreman ? { plannerRepository: 'owner/sandbox' } : {}),
    },
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

it('reports only the configured Foreman capability to the hosted page', async () => {
  const off = await hosted().app.request('/app/api/capabilities');
  expect(off.status).toBe(200);
  expect(off.headers.get('Cache-Control')).toBe('no-store');
  expect(await off.json()).toEqual({ foreman: false });

  const on = await hosted(true).app.request('/app/api/capabilities');
  expect(await on.json()).toEqual({ foreman: true, repository: 'owner/sandbox' });
});

it('serves the AG Studio trial key only to an authenticated buyer and removes it at expiry', async () => {
  const expiresAt = '2026-11-24T00:00:00.000Z';
  const secretKey = 'trial-license-key-never-commit';
  const { app, advance } = hosted(false, { key: secretKey, expiresAt });
  expect((await app.request('/app/api/ag-studio-license')).status).toBe(401);
  const signedIn = await signIn(app, code);
  const cookie = { Cookie: (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  const active = await app.request('/app/api/ag-studio-license', { headers: cookie });
  expect(active.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await active.json()).toEqual({ state: 'licensed', expiresAt, licenseKey: secretKey });
  advance(Date.parse(expiresAt) - 14 * 24 * 60 * 60 * 1000 - 1791158400000);
  const expiringLogin = await signIn(app, code, '203.0.113.2');
  const expiringCookie = { Cookie: (expiringLogin.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  expect(await (await app.request('/app/api/ag-studio-license', { headers: expiringCookie })).json()).toEqual({
    state: 'expiring',
    expiresAt,
    licenseKey: secretKey,
  });
  advance(14 * 24 * 60 * 60 * 1000 + 1);
  const expiredLogin = await signIn(app, code, '203.0.113.3');
  const expiredCookie = { Cookie: (expiredLogin.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  expect(await (await app.request('/app/api/ag-studio-license', { headers: expiredCookie })).json()).toEqual({
    state: 'expired',
    expiresAt,
  });
  expect(
    JSON.stringify(await (await app.request('/app/api/ag-studio-license', { headers: expiredCookie })).json()),
  ).not.toContain(secretKey);
});

it('does not expose the AG Studio key to an authenticated builder session', async () => {
  const { app } = hosted(false, { key: 'test-key', expiresAt: '2026-11-24T00:00:00.000Z' }, 'BUILDER');
  const signedIn = await signIn(app, 'builder-access-code-xxxxxxxxx');
  const cookie = { Cookie: (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  expect((await app.request('/app/api/ag-studio-license', { headers: cookie })).status).toBe(403);
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
