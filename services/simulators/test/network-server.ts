import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createPayPalSimulator } from '../src/paypal.js';

if (process.env.NETWORK_MOCK !== 'true' || process.env.APP_ENV !== 'ci') throw new Error('Mock simulator refused');
const sim = createPayPalSimulator({
  environment: 'ci',
  clock: () => 1791158400000,
  webhookUrl: 'http://api:3000/v1/webhooks/paypal',
});
const lost = new Set<string>();
const app = new Hono();
app.post('/__mock/lose-capture', async (c) => {
  if (c.req.header('Authorization') !== 'Bearer sim-access-token') return c.json({ code: 'unauthorized' }, 401);
  const { authorizationId } = await c.req.json<{ authorizationId: string }>();
  if (typeof authorizationId !== 'string' || !/^SIM-AUTH-\d+$/.test(authorizationId) || lost.size >= 100)
    return c.json({ code: 'invalid_fault' }, 422);
  lost.add(`/v2/payments/authorizations/${authorizationId}/capture`);
  return c.json({ simulated: true });
});
app.all('*', async (c) => {
  const response = await sim.app.fetch(c.req.raw);
  if (c.req.method === 'POST' && response.ok && lost.delete(c.req.path))
    return c.json({ name: 'SIMULATED_LOST_RESPONSE', simulated: true }, 503);
  return response;
});
const server = serve({ fetch: app.fetch, port: 8080, hostname: '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
