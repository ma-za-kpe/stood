import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { PostgresCommitPackages } from './adapters/db-postgres/commit-packages.js';
import { PostgresPlatformApi } from './adapters/db-postgres/platform-api.js';
import * as schema from './adapters/db-postgres/schema.js';
import { PAYMENT_KEYS } from './application/payment-readiness.js';
import { createApp } from './http/app.js';
import { providerRuntime } from './provider-runtime.js';

const providers = await providerRuntime(process.env);
const pool =
  process.env.DATABASE_URL && process.env.STOOD_API_KEY?.trim() && process.env.STOOD_HMAC_SECRET?.trim()
    ? new pg.Pool({ connectionString: process.env.DATABASE_URL })
    : null;
const app = createApp({
  ...(pool
    ? {
        api: {
          store: new PostgresPlatformApi(drizzle(pool, { schema })),
          packages: new PostgresCommitPackages(drizzle(pool, { schema })),
          platformId: process.env.STOOD_PLATFORM_ID ?? 'local-platform',
          key: process.env.STOOD_API_KEY ?? '',
          secret: process.env.STOOD_HMAC_SECRET ?? '',
          clock: Date.now,
        },
      }
    : {}),
  appEnv: process.env.APP_ENV ?? 'local',
  paypalBaseUrl: process.env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com',
  demoMode: process.env.DEMO_MODE === 'true',
  paymentKeys: Object.fromEntries(PAYMENT_KEYS.map((key) => [key, process.env[key] ?? ''])),
  providerHealth: providers.health,
  requestClock: providers.clock,
  clockMode: providers.clockMode,
  providerMode: providers.health()[0]?.mode === 'sim' ? 'sim' : 'live',
});
const port = Number(process.env.PORT ?? '3000');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () =>
    server.close(() => {
      void pool?.end();
    }),
  );
}
