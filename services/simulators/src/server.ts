import { serve } from '@hono/node-server';
import { simulatorConfiguration } from './configuration.js';
import { createPayPalSimulator } from './paypal.js';

const config = simulatorConfiguration(process.env);
const app = createPayPalSimulator({
  environment: config.environment,
  clock: () => Date.parse('2026-10-05T00:00:00Z'),
  ...(process.env.PAYPAL_SIM_WEBHOOK_URL ? { webhookUrl: process.env.PAYPAL_SIM_WEBHOOK_URL } : {}),
}).app;
const server = serve({ fetch: app.fetch, port: config.port, hostname: config.hostname });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close());
