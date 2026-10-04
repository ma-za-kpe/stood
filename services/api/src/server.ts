import { serve } from '@hono/node-server';
import { PAYMENT_KEYS } from './application/payment-readiness.js';
import { createApp } from './http/app.js';

const app = createApp({
  appEnv: process.env.APP_ENV ?? 'local',
  paypalBaseUrl: process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com',
  demoMode: process.env.DEMO_MODE === 'true',
  paymentKeys: Object.fromEntries(PAYMENT_KEYS.map((key) => [key, process.env[key] ?? ''])),
});
const port = Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close());
}
