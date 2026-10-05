import { createHmac, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import pg from 'pg';
import { PostgresCommitPackages } from '../../src/adapters/db-postgres/commit-packages.js';
import { PostgresPlatformApi } from '../../src/adapters/db-postgres/platform-api.js';
import * as schema from '../../src/adapters/db-postgres/schema.js';
import { createApp } from '../../src/http/app.js';
import { providerRuntime } from '../../src/provider-runtime.js';
import { type ScenarioStep, scenarioDefinition } from '../scenarios/scenario-contract.js';
import { NetworkFlow } from './flow.js';

if (process.env.NETWORK_MOCK !== 'true' || process.env.APP_ENV !== 'ci') throw new Error('Mock service refused');
const runtime = await providerRuntime({
  APP_ENV: 'ci',
  PROVIDER_PAYPAL: 'sim',
  PAYPAL_SIM_URL: 'http://paypal-sim:8080',
});
if (!runtime.transport) throw new Error('Mock provider missing');
const pool = new pg.Pool({ connectionString: 'postgres://stood:stood_mock_only@db:5432/stood_mock' });
const db = drizzle(pool, { schema }),
  sessions = new Map<string, NetworkFlow>(),
  seen = new Set<string>();
const app = createApp({
  appEnv: 'ci',
  paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
  demoMode: true,
  requestClock: runtime.clock,
  clockMode: 'controlled',
  providerMode: 'sim',
  providerHealth: runtime.health,
  api: {
    store: new PostgresPlatformApi(db),
    packages: new PostgresCommitPackages(db),
    platformId: 'mock-platform',
    key: 'mock-key',
    secret: 'mock-secret',
    clock: () => 0,
  },
  providerEvents: {
    verify: async (raw, headers) => {
      const m = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(headers.get('Stood-Sim-Signature') ?? '');
      return (
        !!m &&
        headers.get('X-Stood-Simulated') === 'true' &&
        Math.abs((await runtime.clock()) / 1000 - Number(m[1])) <= 300 &&
        timingSafeEqual(
          Buffer.from(m[2] ?? '', 'hex'),
          createHmac('sha256', 'sim-webhook-secret').update(`${m[1]}.${raw}`).digest(),
        )
      );
    },
    enqueue: async (event) => {
      if (!seen.has(event.id)) {
        for (const flow of sessions.values()) await flow.reconcileHint();
        seen.add(event.id);
      }
    },
  },
});
const fixtures = readdirSync('services/api/test/scenarios/stood')
  .filter((f) => f.endsWith('.json'))
  .map((f) => scenarioDefinition(JSON.parse(readFileSync(`services/api/test/scenarios/stood/${f}`, 'utf8'))));
const controls = new Hono();
controls.use('*', bodyLimit({ maxSize: 65536 }));
controls.use('*', async (c, next) => {
  if (c.req.header('Authorization') !== 'Bearer sim-control-key') return c.json({ code: 'unauthorized' }, 401);
  return next();
});
controls.onError((error) => {
  console.error('Synthetic scenario assertion:', error.stack);
  return new Response(JSON.stringify({ code: 'mock_assertion_failed', simulated: true }), {
    status: 409,
    headers: { 'Content-Type': 'application/json' },
  });
});
controls.post('/sessions/:id', (c) => {
  const id = c.req.param('id'),
    scenario = fixtures.find((s) => s.id === id);
  if (!scenario || sessions.has(id)) return c.json({ code: 'invalid_session' }, 409);
  sessions.set(id, new NetworkFlow(scenario, runtime.transport!, runtime.clock));
  return c.json({ id, simulated: true });
});
controls.post('/sessions/:id/steps', async (c) => {
  const flow = sessions.get(c.req.param('id'));
  if (!flow) return c.json({ code: 'unknown_session' }, 404);
  const body = await c.req.json<{ step: ScenarioStep }>();
  await flow.step(body.step);
  return c.json({ accepted: true, trancheId: flow.trancheId, packageId: flow.packageId, simulated: true });
});
controls.get('/sessions/:id/evidence', async (c) => {
  const flow = sessions.get(c.req.param('id'));
  return flow ? c.json(await flow.evidence()) : c.json({ code: 'unknown_session' }, 404);
});
controls.get('/proof/:id', async (c) => {
  const flow = [...sessions.values()].find((s) => s.trancheId === c.req.param('id'));
  return flow ? c.json(await flow.proof()) : c.json({ code: 'unknown_tranche' }, 404);
});
app.route('/__mock', controls);
const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: 3000 });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () =>
    server.close(() => {
      void pool.end();
    }),
  );
