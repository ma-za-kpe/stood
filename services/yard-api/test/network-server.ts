import { randomBytes } from 'node:crypto';
import { serve } from '@hono/node-server';
import pg from 'pg';
import { StoodClient } from '../../../packages/stood-sdk/src/client.js';
import { PostgresForemanCoordinator } from '../../yard-foreman/src/adapters/db-postgres/coordinator.js';
import { Foreman } from '../../yard-foreman/src/foreman.js';
import { PostgresSaver } from '../../yard-foreman/test/fakes/checkpoint.js';
import { ScriptedPlannerModel } from '../../yard-foreman/test/fakes/model.js';
import { LocalKeyWrapper } from '../src/adapters/crypto/local-key-wrapper.js';
import { PostgresYardEvents } from '../src/adapters/db-postgres/events.js';
import { PostgresIntakes } from '../src/adapters/db-postgres/intakes.js';
import { PostgresSecretRows } from '../src/adapters/db-postgres/secrets.js';
import { PostgresSiteLogs } from '../src/adapters/db-postgres/site-log.js';
import { GitleaksScanner } from '../src/adapters/log-scanner/gitleaks.js';
import type { SettlementProof } from '../src/application/board.js';
import { Board } from '../src/application/board.js';
import { IntakePlanner } from '../src/application/intake-planner.js';
import { SecretVault } from '../src/application/secret-vault.js';
import { SiteLog } from '../src/application/site-log.js';
import { createYardApp } from '../src/http/app.js';
import { startLogRetention } from '../src/jobs/site-log-retention.js';
import { browserSession } from './fakes/browser-session.js';

if (process.env.NETWORK_MOCK !== 'true' || process.env.APP_ENV !== 'ci') throw new Error('Mock Yard refused');
const pool = new pg.Pool({ connectionString: 'postgres://yard_runtime:sim-yard-database-only@db:5432/stood_mock' });
await pool.query('SELECT version FROM yard.schema_migrations WHERE version=1');
const clock = async () => {
  const response = await fetch('http://paypal-sim:8080/__sim/time', {
    headers: { Authorization: 'Bearer sim-access-token' },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok || response.headers.get('X-Stood-Simulated') !== 'true') throw new Error('Mock clock unavailable');
  const value = (await response.json()) as { now: number; simulated: boolean };
  if (value.simulated !== true || !Number.isSafeInteger(value.now) || value.now < 0)
    throw new Error('Mock clock unavailable');
  return value.now;
};
const events = new PostgresYardEvents(pool, clock);
const intakes = new PostgresIntakes(pool, events);
const foreman = new Foreman(
  new ScriptedPlannerModel('ci'),
  new PostgresSaver(pool, undefined, { schema: 'yard' }),
  true,
  new PostgresForemanCoordinator(pool),
);
const board = new Board(events);
const logs = new PostgresSiteLogs(pool, events);
const retention = startLogRetention(logs, clock, (code) => console.warn(JSON.stringify({ code })));
await retention.run();
const scanner = new GitleaksScanner();
await scanner.ready();
const app = createYardApp({
  environment: 'ci',
  board: {
    board,
    // Disposable mock data: a random key-encryption key per boot, never a real secret.
    secrets: new SecretVault(
      new PostgresSecretRows(pool),
      new LocalKeyWrapper({ k1: randomBytes(32).toString('base64') }, 'k1'),
    ),
    siteLog: new SiteLog(logs, board, scanner),
    clock,
    intakes,
    foreman,
    intakePlanner: new IntakePlanner(intakes, foreman, {
      resolve: async (buyer, repository) => {
        const response = await fetch(
          `http://crew:8081/__mock/repository/head?buyer=${encodeURIComponent(buyer)}&repository=${encodeURIComponent(repository)}`,
          { headers: { Authorization: 'Bearer sim-control-key' }, signal: AbortSignal.timeout(5000) },
        );
        if (!response.ok) throw new Error('Simulated repository unavailable');
        const proof = (await response.json()) as { repository: string; baseCommit: string; simulated: boolean };
        if (proof.simulated !== true) throw new Error('Repository proof is not simulated');
        return proof;
      },
    }),
    packages: {
      submit: async (input) => {
        const now = await clock();
        const client = new StoodClient({
          baseUrl: 'https://stood.mock.invalid',
          key: 'mock-key',
          secret: 'mock-secret',
          clock: () => now,
          transport: (request) => fetch(new Request(`http://api:3000${new URL(request.url).pathname}`, request)),
        });
        const receipt = await client.submitPackage(
          input.trancheId,
          {
            repository: input.repository,
            base_commit: input.baseCommit,
            commit_sha: input.commit,
            report_ref: 'reports/yard-first.json',
            report_sha256: 'c'.repeat(64),
          },
          input.key,
        );
        return {
          id: receipt.id,
          trancheId: receipt.trancheId,
          repository: receipt.metadata.repository,
          baseCommit: receipt.metadata.base_commit,
          commit: receipt.metadata.commit_sha,
        };
      },
    },
    operators: [
      {
        key: 'sim-buyer-key',
        secret: 'sim-buyer-secret',
        actor: { id: 'buyer', root: 'buyer-operator', kind: 'BUYER' },
      },
      {
        key: 'sim-builder-key',
        secret: 'sim-builder-secret',
        actor: { id: 'sim-crew', root: 'sim-crew-operator', kind: 'BUILDER' },
      },
    ],
    stood: {
      mode: 'sim',
      secret: 'sim-stood-webhook-secret',
      read: async (id) => {
        const response = await fetch(`http://api:3000/__mock/proof/${encodeURIComponent(id)}`, {
          headers: { Authorization: 'Bearer sim-control-key' },
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error('Stood proof unavailable');
        return response.json() as Promise<Omit<SettlementProof, 'eventId'>>;
      },
    },
  },
});
browserSession(app, clock);
const server = serve({ fetch: app.fetch, hostname: '0.0.0.0', port: 3001 });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    retention.stop();
    server.close(() => {
      void pool.end();
    });
  });
