import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

type Credentials = Readonly<{ key: string; secret: string; role: 'buyer' | 'builder' }>;
const PATHS = /^\/(board|blueprints|plans|intakes)(\/|$)/;

// Forward a browser request to the signed Yard API as one operator. The browser never sees the signing secret.
export async function forwardSigned(app: Hono, c: Context, who: Credentials, now: number): Promise<Response> {
  const suffix = c.req.path.slice('/app/api'.length);
  if (!PATHS.test(suffix)) return c.json({ code: 'forbidden' }, 403);
  const body = c.req.method === 'GET' ? '' : await c.req.text();
  const t = String(Math.floor(now / 1000));
  const headers = new Headers({ 'Yard-Key-Id': who.key });
  for (const name of ['If-Match', 'Idempotency-Key', 'Last-Event-ID', 'Content-Type']) {
    const value = c.req.header(name);
    if (value) headers.set(name, value);
  }
  const url = new URL(c.req.url);
  url.pathname = `/yard/v1${suffix}`;
  headers.set(
    'Yard-Signature',
    `t=${t},v2=${createHmac('sha256', who.secret)
      .update(
        JSON.stringify([
          'yard.request@2',
          t,
          who.key,
          c.req.method,
          `${url.pathname}${url.search}`,
          headers.get('Idempotency-Key') ?? '',
          headers.get('If-Match') ?? '',
          headers.get('Content-Type') ?? '',
          headers.get('Last-Event-ID') ?? '',
          body,
        ]),
      )
      .digest('hex')}`,
  );
  const response = await app.fetch(
    new Request(url, { method: c.req.method, headers, ...(body ? { body } : {}), signal: c.req.raw.signal }),
  );
  return new Response(response.body, { status: response.status, headers: response.headers });
}

type Operator = Readonly<{
  key: string;
  secret: string;
  accessCode?: string;
  notAfter?: number;
  actor: { kind: 'BUYER' | 'BUILDER' };
}>;
const SESSION_MS = 8 * 3600_000;
const WINDOW_MS = 60_000;
const MAX_FAILURES = 10;
const digest = (s: string) => createHash('sha256').update(s).digest();

// T-0266: hosted sign-in. The owner gives each operator an access code; signing in creates an opaque, expiring
// session id (in memory: one instance; a restart signs everyone out). Changes must come from the page's own origin.
export function hostedSessions(
  app: Hono,
  config: Readonly<{ operators: readonly Operator[]; clock(): Promise<number>; origin: string }>,
): void {
  const sessions = new Map<string, { key: string; expiresAt: number }>();
  const failures = new Map<string, { count: number; since: number }>();
  const coded = config.operators.filter((o) => typeof o.accessCode === 'string' && o.accessCode.length >= 24);
  const role = (o: Operator) => (o.actor.kind === 'BUYER' ? 'buyer' : 'builder') as Credentials['role'];
  const current = async (c: Context) => {
    const id = getCookie(c, 'yard-session') ?? '';
    const found = sessions.get(id);
    if (!found) return null;
    const sessionNow = await config.clock();
    if (sessionNow >= found.expiresAt) {
      sessions.delete(id);
      return null;
    }
    return (
      config.operators.find((o) => o.key === found.key && (o.notAfter === undefined || sessionNow < o.notAfter)) ?? null
    );
  };
  app.use('/app/api/*', bodyLimit({ maxSize: 65536 }));
  app.use('/app/api/*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    if (!['GET', 'HEAD'].includes(c.req.method) && c.req.header('Origin') !== config.origin)
      return c.json({ code: 'forbidden' }, 403);
    await next();
  });
  app.get('/app/api/session', async (c) => {
    const o = await current(c);
    return c.json({ mode: 'hosted', role: o ? role(o) : null });
  });
  app.post('/app/api/session', async (c) => {
    const now = await config.clock();
    const ip = (c.req.header('X-Forwarded-For') ?? 'unknown').split(',')[0]?.trim() ?? 'unknown';
    for (const [key, value] of failures) if (now - value.since >= WINDOW_MS) failures.delete(key);
    for (const [key, value] of sessions) if (now >= value.expiresAt) sessions.delete(key);
    if (failures.size >= 1000 || sessions.size >= 1000) return c.json({ code: 'too_many_attempts' }, 429);
    const seen = failures.get(ip);
    if (seen && now - seen.since >= WINDOW_MS) failures.delete(ip);
    if ((failures.get(ip)?.count ?? 0) >= MAX_FAILURES) return c.json({ code: 'too_many_attempts' }, 429);
    let code = '';
    try {
      const input = (await c.req.json()) as { access_code?: unknown };
      code = typeof input?.access_code === 'string' ? input.access_code : '';
    } catch {}
    const match = coded.find(
      (o) =>
        (o.notAfter === undefined || now < o.notAfter) && timingSafeEqual(digest(o.accessCode as string), digest(code)),
    );
    if (!match) {
      const f = failures.get(ip) ?? { count: 0, since: now };
      failures.set(ip, { count: f.count + 1, since: f.since });
      return c.json({ code: 'unauthorized' }, 401);
    }
    sessions.delete(getCookie(c, 'yard-session') ?? '');
    const id = randomBytes(32).toString('base64url');
    sessions.set(id, { key: match.key, expiresAt: now + SESSION_MS });
    setCookie(c, 'yard-session', id, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/app/api',
      maxAge: SESSION_MS / 1000,
    });
    return c.json({ mode: 'hosted', role: role(match) });
  });
  app.delete('/app/api/session', (c) => {
    sessions.delete(getCookie(c, 'yard-session') ?? '');
    deleteCookie(c, 'yard-session', { path: '/app/api', secure: true });
    return c.json({ mode: 'hosted', role: null });
  });
  app.all('/app/api/*', async (c) => {
    const o = await current(c);
    if (!o) return c.json({ code: 'unauthorized' }, 401);
    return forwardSigned(app, c, { key: o.key, secret: o.secret, role: role(o) }, await config.clock());
  });
}
