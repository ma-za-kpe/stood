import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import { forwardSigned } from '../../src/http/browser-session.js';
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
  app.get('/app/api/session', (c) => {
    const role = getCookie(c, 'yard-mock-session');
    return c.json({ mode: 'mock', role: role === 'buyer' || role === 'builder' ? role : null });
  });
  app.all('/app/api/*', async (c) => {
    const role = getCookie(c, 'yard-mock-session');
    if (role !== 'buyer' && role !== 'builder') return c.json({ code: 'unauthorized' }, 401);
    const who =
      role === 'buyer'
        ? ({ key: 'sim-buyer-key', secret: 'sim-buyer-secret', role } as const)
        : ({ key: 'sim-builder-key', secret: 'sim-builder-secret', role } as const);
    return forwardSigned(app, c, who, await clock());
  });
}
