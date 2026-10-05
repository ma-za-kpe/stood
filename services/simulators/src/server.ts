import { serve } from '@hono/node-server';
import { createPayPalSimulator } from './paypal.js';

const app = createPayPalSimulator({
  environment: process.env.APP_ENV ?? 'local',
  clock: () => Date.parse('2026-10-05T00:00:00Z'),
}).app;
const port = Number(process.env.PORT ?? '8080');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid simulator PORT');
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
