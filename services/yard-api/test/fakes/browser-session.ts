import { createHmac } from 'node:crypto';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
// Isolated mock composition only. Production authentication is a separate port.
// Neither browser bundles nor cookies contain platform HMAC keys.
export function browserSession(app: Hono, clock: () => Promise<number>): void {
  app.use('/app/api/*', bodyLimit({ maxSize: 65536 }));
  app.post('/app/api/demo/session', async (c) => {
    const input: unknown = await c.req.json();
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).join() !== 'role' ||
      !['buyer', 'builder'].includes(String((input as { role?: unknown }).role))
    )
      return c.json({ code: 'invalid_role' }, 422);
    const role = (input as { role: 'buyer' | 'builder' }).role;
    setCookie(c, 'yard-mock-session', role, { httpOnly: true, sameSite: 'Strict', path: '/app/api', maxAge: 3600 });
    return c.json({ role, simulated: true });
  });
  app.all('/app/api/*', async (c) => {
    const role = getCookie(c, 'yard-mock-session');
    if (role !== 'buyer' && role !== 'builder') return c.json({ code: 'unauthorized' }, 401);
    const suffix = c.req.path.slice('/app/api'.length);
    if (!/^\/(board|blueprints|plans)(\/|$)/.test(suffix)) return c.json({ code: 'forbidden' }, 403);
    const path = `/yard/v1${suffix}`,
      body = c.req.method === 'GET' ? '' : await c.req.text(),
      t = String(Math.floor((await clock()) / 1000));
    const key = role === 'buyer' ? 'sim-buyer-key' : 'sim-builder-key',
      secret = role === 'buyer' ? 'sim-buyer-secret' : 'sim-builder-secret';
    const headers = new Headers({
      'Yard-Key-Id': key,
      'Yard-Signature': `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${c.req.method}.${path}.${body}`).digest('hex')}`,
    });
    for (const name of ['If-Match', 'Idempotency-Key', 'Last-Event-ID']) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    const url = new URL(c.req.url);
    url.pathname = path;
    const response = await app.fetch(
      new Request(url, { method: c.req.method, headers, ...(body ? { body } : {}), signal: c.req.raw.signal }),
    );
    return new Response(response.body, { status: response.status, headers: response.headers });
  });
}
