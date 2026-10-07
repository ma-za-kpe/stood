import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { StoodClient } from '../../../packages/stood-sdk/src/client.js';
import { FaultController } from '../../simulators/src/faults.js';
import { ControlledClockClient } from '../src/adapters/controlled-clock/client.js';
import { PostgresCommitPackages } from '../src/adapters/db-postgres/commit-packages.js';
import { confirmedCaptures } from '../src/adapters/db-postgres/ledger-captures.js';
import { PostgresPlatformApi } from '../src/adapters/db-postgres/platform-api.js';
import * as schema from '../src/adapters/db-postgres/schema.js';
import { PostgresTranches } from '../src/adapters/db-postgres/tranches.js';
import { PayPalAdapter } from '../src/adapters/payments-paypal/adapter.js';
import { HttpTransactionSearch } from '../src/adapters/payments-paypal/transactions.js';
import { executePayment } from '../src/application/execute-payment.js';
import { reconcile } from '../src/application/reconcile.js';
import { auditCaptures } from '../src/application/reconciliation-audit.js';
import { retryCapture } from '../src/application/retry-capture.js';
import { type CheckResult, decide, getProfile } from '../src/domain/decision.js';
import { restoreTrancheRecord, type TrancheCommand } from '../src/domain/tranche-record.js';
import { createApp } from '../src/http/app.js';
import { simulatorServer } from './contracts/paypal-simulator.js';
import {
  attemptAssessment,
  runScenario,
  type ScenarioEvidence,
  type ScenarioStep,
  scenarioDefinition,
} from './scenarios/scenario-contract.js';

// Fixed local Postgres only, separate random database, migrations from scratch. Never DATABASE_URL.
const name = `test_mock_flow_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const connectionString = `postgres://stood:stood_local_only@db:5432/${name}`;
const pool = new pg.Pool({ connectionString, options: '-c statement_timeout=5000' });
const db = drizzle(pool, { schema });
const scenarios = readdirSync('services/api/test/scenarios/stood')
  .filter((f) => f.endsWith('.json'))
  .map((f) => scenarioDefinition(JSON.parse(readFileSync(`services/api/test/scenarios/stood/${f}`, 'utf8'))));
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});

it.each(scenarios)('mock integration: $id (fixture setup, actual Postgres and HTTP)', async (scenario) => {
  const faults = ['capture-lost-response', 'capture-missed-send'].includes(scenario.id)
    ? new FaultController([
        {
          method: 'POST',
          path: '/v2/payments/authorizations/SIM-AUTH-3/capture',
          kind: scenario.id === 'capture-missed-send' ? 'HTTP_500' : 'LOST_RESPONSE',
        },
      ])
    : undefined;
  const h = await simulatorServer(faults);
  const calls = vi.spyOn(h.transport, 'call');
  const clock = new ControlledClockClient('ci', h.baseUrl);
  let store = new PostgresTranches(db);
  let adapter = new PayPalAdapter(h.transport, store, () => clock.read());
  let restarted: pg.Pool | undefined;
  let trancheId = '';
  let authorizationId = '';
  let attempt = 1;
  let at = await clock.read();
  const seen = new Set<string>();
  const app = createApp({
    appEnv: 'ci',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    demoMode: false,
    providerMode: 'sim',
    clockMode: 'controlled',
    requestClock: () => clock.read(),
    api: {
      store: new PostgresPlatformApi(db),
      packages: new PostgresCommitPackages(db),
      platformId: 'mock-platform',
      key: 'mock-key',
      secret: 'mock-secret',
      clock: () => at,
    },
    providerEvents: {
      verify: async (body, headers) => {
        const sig = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(headers.get('Stood-Sim-Signature') ?? '');
        return (
          !!sig &&
          headers.get('X-Stood-Simulated') === 'true' &&
          Math.abs((await clock.read()) / 1000 - Number(sig[1])) <= 300 &&
          timingSafeEqual(
            Buffer.from(sig[2] ?? '', 'hex'),
            createHmac('sha256', 'sim-webhook-secret').update(`${sig[1]}.${body}`).digest(),
          )
        );
      },
      enqueue: async (event) => {
        if (!seen.has(event.id)) {
          // Read real matching provider proof. A webhook itself never changes settlement state.
          await reconcile(store, adapter, trancheId, await clock.read());
          seen.add(event.id);
        }
      },
    },
  });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No Stood listener');
  const origin = `http://127.0.0.1:${address.port}`;
  const client = new StoodClient({ baseUrl: origin, key: 'mock-key', secret: 'mock-secret', clock: () => at });
  const apply = async (command: TrancheCommand) => {
    const value = await store.load(trancheId);
    await store.apply(trancheId, value.version, `${scenario.id}:${value.version}:${command.method}`, command);
  };
  const readTranche = async () => {
    const t = String(Math.floor(at / 1000));
    const response = await fetch(`${origin}/v1/tranches/${trancheId}`, {
      headers: {
        Authorization: 'Bearer mock-key',
        'Stood-Signature': `t=${t},v2=${createHmac('sha256', 'mock-secret')
          .update(JSON.stringify(['stood.request@2', t, 'GET', `/v1/tranches/${trancheId}`, '', '', '', '']))
          .digest('hex')}`,
      },
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<{
      state: string;
      settlement: { effect: 'CAPTURE' | 'VOID' | 'EXPIRE'; reference: string } | null;
    }>;
  };
  try {
    const evidence = await runScenario(scenario, {
      step: async (step: ScenarioStep) => {
        at = await clock.read();
        switch (step) {
          case 'DRAFT': {
            const draft = await client.createDraft(
              {
                payee_ref: 'sim-builder',
                cap: { minor: 1000, currency: 'USD' },
                milestones: [
                  { name: 'build', amount: { minor: 1000, currency: 'USD' }, profile: scenario.profile, params: {} },
                ],
                window_days: 7,
                max_resubmits: 1,
              },
              scenario.id,
            );
            trancheId = draft.tranches[0]?.id ?? '';
            expect(trancheId).not.toBe('');
            expect((await client.getDraft(draft.id)).status).toBe('DRAFT');
            return;
          }
          case 'AUTHORIZE_FIXTURE':
            authorizationId = (await h.seed(trancheId)).authorizationId;
            return;
          case 'DISPATCH':
            await apply({ method: 'dispatch', args: [authorizationId, 'K7Q', at, at + 29 * 86400000] });
            return;
          case 'PACKAGE': {
            const pkg = await client.submitPackage(
              trancheId,
              {
                repository: 'buyer/project',
                base_commit: 'a'.repeat(40),
                commit_sha: (attempt === 1 ? 'b' : 'e').repeat(40),
                report_ref: `reports/${scenario.id}.json`,
                report_sha256: 'c'.repeat(64),
              },
              attempt === 1 ? `${scenario.id}:package` : `${scenario.id}:package:${attempt}`,
            );
            expect(await client.getPackage(trancheId, pkg.id)).toEqual(pkg);
            return;
          }
          case 'ADVANCE_DAY_FOUR':
            h.advance(4);
            return;
          case 'ADVANCE_EXPIRY':
            h.advance(29);
            return;
          case 'RENEW':
            await apply({ method: 'beginReauthorization', args: [at] });
            expect(await executePayment(store, adapter, trancheId, 'renewal-worker', () => at)).toBe('RESOLVED');
            expect(restoreTrancheRecord((await store.load(trancheId)).record).currentHold.authorizationId).not.toBe(
              authorizationId,
            );
            return;
          case 'EXPIRE':
            await apply({ method: 'expire', args: [at] });
            return;
          case 'REDISPATCH':
            await apply({ method: 'redispatch', args: [] });
            attempt++;
            return;
          case 'ASSESS_FIXTURE': {
            const assessment = attemptAssessment(scenario, attempt);
            const checks = getProfile(scenario.profile).checks.map<CheckResult>(({ code, source }) => {
              if (code === 'test_integrity' && assessment === 'INTEGRITY_FAIL')
                return {
                  code,
                  source: 'RULE',
                  status: 'FAIL',
                  reason: 'signed_tests_changed',
                  namedField: 'signed_tests_changed',
                };
              if (code === 'mutation_score' && assessment === 'WEAK_TESTS')
                return { code, source: 'RULE', status: 'FAIL', reason: 'weak_tests', namedField: 'weak_tests' };
              if (code === 'usage_release' && assessment === 'USAGE_PENDING')
                return { code, source: 'RULE', status: 'UNCERTAIN', reason: 'usage_pending' };
              if (source === 'MODEL')
                return { code, source, confidence: 1, status: 'PASS', reason: 'synthetic_fixture' };
              return { code, source, status: 'PASS', reason: 'synthetic_fixture' };
            });
            await apply({ method: 'startDeciding', args: [] });
            await apply({
              method: 'beginSettlement',
              args: [
                decide(scenario.profile, checks),
                attempt === 1 ? `${scenario.id}:decision` : `${scenario.id}:decision:${attempt}`,
                at,
              ],
            });
            return;
          }
          case 'EXECUTE': {
            const result = await executePayment(store, adapter, trancheId, 'capture-worker', () => at);
            if (['capture-lost-response', 'capture-missed-send'].includes(scenario.id)) {
              expect(result).toBe('WAIT');
              expect((await store.load(trancheId)).pending?.status).toBe('AMBIGUOUS');
              expect(await executePayment(store, adapter, trancheId, 'no-blind-retry', () => at)).toBe('WAIT');
              expect(calls.mock.calls.filter(([action]) => action === 'CAPTURE')).toHaveLength(1);
            }
            return;
          }
          case 'RESTART': {
            const before = (await store.load(trancheId)).pending?.providerRequestId;
            restarted = new pg.Pool({ connectionString, options: '-c statement_timeout=5000' });
            store = new PostgresTranches(drizzle(restarted, { schema }));
            adapter = new PayPalAdapter(h.transport, store, () => clock.read());
            expect((await store.load(trancheId)).pending?.providerRequestId).toBe(before);
            return;
          }
          case 'RETRY_CAPTURE':
            expect(await retryCapture(store, adapter, adapter, trancheId, 'retry-worker', () => at)).toBe(
              scenario.id === 'capture-missed-send' ? 'RESOLVED' : 'DONE',
            );
            return;
          case 'RECONCILE':
            await reconcile(store, adapter, trancheId, at);
            return;
          case 'VERIFY': {
            const indices = h
              .events()
              .map((_, index) => index)
              .reverse();
            await h.deliver(`${origin}/v1/webhooks/paypal`, [...indices, ...indices]);
            expect(seen.size).toBe(h.events().length);
            const health = await (await fetch(`${origin}/health`)).json();
            expect(health).toMatchObject({ paymentReady: false, clock: { now: at, mode: 'controlled' } });
            return;
          }
        }
      },
      observe: async (): Promise<ScenarioEvidence> => {
        const value = await store.load(trancheId);
        const tranche = restoreTrancheRecord(value.record);
        const projected = await readTranche(); // Public signed projection, not a private shortcut to a paid state.
        expect(projected.state).toBe(tranche.state);
        expect(value.pending).toBeNull();
        const operations = await db
          .select()
          .from(schema.paymentOperations)
          .where(eq(schema.paymentOperations.trancheId, trancheId));
        const settlements = operations.filter((o) => o.operation.effect !== 'REAUTHORIZE');
        let ledger = settlements[0];
        if (scenario.reworkAssessment) {
          // The refused attempt is voided and confirmed before the fresh hold; only the final attempt captures.
          expect(settlements).toHaveLength(2);
          expect(settlements.filter((o) => o.operation.effect === 'VOID' && o.status === 'CONFIRMED')).toHaveLength(1);
          expect(settlements.filter((o) => o.operation.effect === 'CAPTURE')).toHaveLength(1);
          ledger = settlements.find((o) => o.operation.effect === 'CAPTURE');
        } else expect(settlements.length).toBeLessThanOrEqual(1);
        const history = await db
          .select()
          .from(schema.paymentOperationEvents)
          .where(eq(schema.paymentOperationEvents.trancheId, trancheId));
        if (ledger)
          expect(history.filter((e) => e.key === ledger.key).sort((a, b) => b.version - a.version)[0]).toMatchObject({
            status: ledger.status,
            reference: ledger.reference,
          });
        const input = {
          authorizationId: tranche.currentHold.authorizationId,
          requestId: 'read',
          operationKey: 'read',
          amount: { currencyCode: 'USD', value: '10.00' },
        };
        const auth = (await h.transport.call('GET_AUTHORIZATION', input)).body as {
          status: string;
          supplementary_data: { related_ids: { order_id: string } };
        };
        const order = (
          await h.transport.call('GET_ORDER', {
            ...input,
            authorizationId: auth.supplementary_data.related_ids.order_id,
          })
        ).body as {
          purchase_units: { payments: { captures: { id: string; invoice_id: string }[] } }[];
        };
        const captures = order.purchase_units[0]?.payments.captures ?? [];
        // T-0155: the provider's captures and Stood's confirmed ledger agree exactly.
        const search = new HttpTransactionSearch({ baseUrl: h.baseUrl, token: async () => 'sim-access-token' });
        const provider = (await search.captures(0, at + 366 * 86400000)).filter((p) =>
          captures.some((c) => c.id === p.id),
        );
        expect(auditCaptures(await confirmedCaptures(db, trancheId), provider)).toEqual([]);
        const captureCalls = calls.mock.calls.filter(([action]) => action === 'CAPTURE');
        expect(captureCalls).toHaveLength(scenario.expected.captures + (scenario.id === 'capture-missed-send' ? 1 : 0));
        expect(new Set(captureCalls.map(([, input]) => input.requestId)).size).toBeLessThanOrEqual(1);
        if (captures[0]) expect(captures[0].invoice_id).toBe(ledger?.key);
        return {
          domainState: projected.state,
          providerState: auth.status,
          captures: captures.length,
          settlementEffect: projected.settlement?.effect ?? null,
          ledgerStatus: ledger?.status === 'CONFIRMED' || ledger?.status === 'FAILED' ? ledger.status : null,
          domainReference: projected.settlement?.reference ?? null,
          ledgerReference: ledger?.reference ?? null,
          providerReference: projected.settlement
            ? (captures[0]?.id ??
              `${auth.supplementary_data.related_ids.order_id}:${tranche.currentHold.authorizationId}`)
            : null,
          simulated: true,
          moneyExecuted: false,
        };
      },
    });
    expect(evidence.simulated).toBe(true);
  } finally {
    if ('closeAllConnections' in server) server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    await restarted?.end();
    await h.close();
  }
});
