import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { StoodClient } from '../../../../packages/stood-sdk/src/client.js';
import * as schema from '../../src/adapters/db-postgres/schema.js';
import { PostgresTranches } from '../../src/adapters/db-postgres/tranches.js';
import { PayPalAdapter } from '../../src/adapters/payments-paypal/adapter.js';
import type { PayPalTransport } from '../../src/adapters/payments-paypal/sdk.js';
import { executePayment } from '../../src/application/execute-payment.js';
import { reconcile } from '../../src/application/reconcile.js';
import { type CheckResult, decide, getProfile } from '../../src/domain/decision.js';
import { restoreTrancheRecord, type TrancheCommand } from '../../src/domain/tranche-record.js';
import type { Scenario, ScenarioEvidence, ScenarioStep } from '../scenarios/scenario-contract.js';

const connection = 'postgres://stood:stood_mock_only@db:5432/stood_mock';
const paypal = 'http://paypal-sim:8080';
export class NetworkFlow {
  private pool = new pg.Pool({ connectionString: connection });
  private store = new PostgresTranches(drizzle(this.pool, { schema }));
  private adapter: PayPalAdapter;
  private transport: PayPalTransport;
  private captures = 0;
  private index = 0;
  trancheId = '';
  packageId = '';
  authorizationId = '';
  private at = 0;
  constructor(
    readonly scenario: Scenario,
    transport: PayPalTransport,
    private readonly clock: () => Promise<number>,
  ) {
    this.transport = {
      call: async (action, input) => {
        if (action === 'CAPTURE') this.captures++;
        return transport.call(action, input);
      },
    };
    this.adapter = new PayPalAdapter(this.transport, this.store);
  }
  private client() {
    return new StoodClient({
      baseUrl: 'http://127.0.0.1:3000',
      key: 'mock-key',
      secret: 'mock-secret',
      clock: () => this.at,
    });
  }
  private async apply(command: TrancheCommand) {
    const value = await this.store.load(this.trancheId);
    await this.store.apply(
      this.trancheId,
      value.version,
      `${this.scenario.id}:${value.version}:${command.method}`,
      command,
    );
  }
  private async control(path: string, value: unknown = {}) {
    const response = await fetch(`${paypal}${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
      signal: AbortSignal.timeout(3000),
    });
    assert(response.ok);
    return response.json() as Promise<Record<string, unknown>>;
  }
  async step(step: ScenarioStep) {
    assert.equal(step, this.scenario.steps[this.index], 'Scenario steps must run in order');
    this.at = await this.clock();
    switch (step) {
      case 'DRAFT': {
        const draft = await this.client().createDraft(
          {
            payee_ref: 'sim-builder',
            cap: { minor: 1000, currency: 'USD' },
            milestones: [
              { name: 'build', amount: { minor: 1000, currency: 'USD' }, profile: this.scenario.profile, params: {} },
            ],
            window_days: 7,
            max_resubmits: 1,
          },
          this.scenario.id,
        );
        this.trancheId = draft.tranches[0]?.id ?? '';
        assert(this.trancheId);
        assert.equal((await this.client().getDraft(draft.id)).status, 'DRAFT');
        break;
      }
      case 'AUTHORIZE_FIXTURE': {
        const headers = {
          Authorization: 'Bearer sim-access-token',
          'Content-Type': 'application/json',
          'PayPal-Request-Id': `${this.scenario.id}:order`,
        };
        const response = await fetch(`${paypal}/v2/checkout/orders`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            intent: 'AUTHORIZE',
            purchase_units: [{ custom_id: this.trancheId, amount: { currency_code: 'USD', value: '10.00' } }],
          }),
        });
        assert(response.ok);
        const order = (await response.json()) as { id: string };
        await this.control(`/__sim/approve/${order.id}`);
        const authorization = await fetch(`${paypal}/v2/checkout/orders/${order.id}/authorize`, {
          method: 'POST',
          headers: { ...headers, 'PayPal-Request-Id': `${this.scenario.id}:authorize` },
          body: '{}',
        });
        assert(authorization.ok);
        const body = (await authorization.json()) as {
          purchase_units: { payments: { authorizations: { id: string }[] } }[];
        };
        this.authorizationId = body.purchase_units[0]?.payments.authorizations[0]?.id ?? '';
        assert(this.authorizationId);
        if (this.scenario.id === 'capture-lost-response')
          await this.control('/__mock/lose-capture', { authorizationId: this.authorizationId });
        break;
      }
      case 'DISPATCH':
        await this.apply({ method: 'dispatch', args: [this.authorizationId, 'K7Q', this.at, this.at + 29 * 86400000] });
        break;
      case 'PACKAGE': {
        const pkg = await this.client().submitPackage(
          this.trancheId,
          {
            repository: 'buyer/project',
            base_commit: 'a'.repeat(40),
            commit_sha: 'b'.repeat(40),
            report_ref: `reports/${this.scenario.id}.json`,
            report_sha256: 'c'.repeat(64),
          },
          `${this.scenario.id}:package`,
        );
        this.packageId = pkg.id;
        assert.deepEqual(await this.client().getPackage(this.trancheId, pkg.id), pkg);
        break;
      }
      case 'ADVANCE_DAY_FOUR':
        await this.control('/__sim/advance', { milliseconds: 4 * 86400000 });
        break;
      case 'ADVANCE_EXPIRY':
        await this.control('/__sim/advance', { milliseconds: 29 * 86400000 });
        break;
      case 'RENEW':
        await this.apply({ method: 'beginReauthorization', args: [this.at] });
        assert.equal(
          await executePayment(this.store, this.adapter, this.trancheId, 'network-renew', () => this.at),
          'RESOLVED',
        );
        break;
      case 'EXPIRE':
        await this.apply({ method: 'expire', args: [this.at] });
        break;
      case 'ASSESS_FIXTURE': {
        const checks = getProfile(this.scenario.profile).checks.map<CheckResult>(({ code, source }) => {
          if (code === 'test_integrity' && this.scenario.assessment === 'INTEGRITY_FAIL')
            return {
              code,
              source: 'RULE',
              status: 'FAIL',
              reason: 'signed_tests_changed',
              namedField: 'signed_tests_changed',
            };
          if (code === 'mutation_score' && this.scenario.assessment === 'WEAK_TESTS')
            return { code, source: 'RULE', status: 'FAIL', reason: 'weak_tests', namedField: 'weak_tests' };
          if (code === 'usage_release' && this.scenario.assessment === 'USAGE_PENDING')
            return { code, source: 'RULE', status: 'UNCERTAIN', reason: 'usage_pending' };
          return source === 'MODEL'
            ? { code, source, status: 'PASS', confidence: 1, reason: 'synthetic_fixture' }
            : { code, source, status: 'PASS', reason: 'synthetic_fixture' };
        });
        await this.apply({ method: 'startDeciding', args: [] });
        await this.apply({
          method: 'beginSettlement',
          args: [decide(this.scenario.profile, checks), `${this.scenario.id}:decision`, this.at],
        });
        break;
      }
      case 'EXECUTE': {
        const result = await executePayment(this.store, this.adapter, this.trancheId, 'network-execute', () => this.at);
        if (this.scenario.id === 'capture-lost-response') {
          assert.equal(result, 'WAIT');
          assert.equal((await this.store.load(this.trancheId)).pending?.status, 'AMBIGUOUS');
          assert.equal(
            await executePayment(this.store, this.adapter, this.trancheId, 'no-blind-retry', () => this.at),
            'WAIT',
          );
          assert.equal(this.captures, 1);
        }
        break;
      }
      case 'RESTART': {
        const before = (await this.store.load(this.trancheId)).pending?.providerRequestId;
        await this.pool.end();
        this.pool = new pg.Pool({ connectionString: connection });
        this.store = new PostgresTranches(drizzle(this.pool, { schema }));
        this.adapter = new PayPalAdapter(this.transport, this.store);
        assert.equal((await this.store.load(this.trancheId)).pending?.providerRequestId, before);
        break;
      }
      case 'RECONCILE':
        await reconcile(this.store, this.adapter, this.trancheId, this.at);
        break;
      case 'VERIFY': {
        const events = (await (
          await fetch(`${paypal}/v1/notifications/webhooks-events`, {
            headers: { Authorization: 'Bearer sim-access-token' },
          })
        ).json()) as { events: unknown[] };
        const indices = events.events.map((_, i) => i).reverse();
        await this.control('/__sim/webhooks/deliver', { indices: [...indices, ...indices] });
        break;
      }
    }
    this.index++;
  }
  async reconcileHint() {
    if (this.trancheId) await reconcile(this.store, this.adapter, this.trancheId, await this.clock());
  }
  async evidence(): Promise<ScenarioEvidence> {
    assert.equal(this.index, this.scenario.steps.length);
    const db = drizzle(this.pool, { schema }),
      snapshot = await this.store.load(this.trancheId),
      tranche = restoreTrancheRecord(snapshot.record);
    assert.equal(snapshot.pending, null);
    const at = await this.clock(),
      t = String(Math.floor(at / 1000));
    const response = await fetch(`http://api:3000/v1/tranches/${this.trancheId}`, {
      headers: {
        Authorization: 'Bearer mock-key',
        'Stood-Signature': `t=${t},v1=${createHmac('sha256', 'mock-secret').update(`${t}.`).digest('hex')}`,
      },
    });
    assert(response.ok);
    const projected = (await response.json()) as {
      state: string;
      settlement: { effect: 'CAPTURE' | 'VOID' | 'EXPIRE'; reference: string } | null;
    };
    assert.equal(projected.state, tranche.state);
    const operations = await db
      .select()
      .from(schema.paymentOperations)
      .where(eq(schema.paymentOperations.trancheId, this.trancheId));
    const settlements = operations.filter((o) => o.operation.effect !== 'REAUTHORIZE');
    assert(settlements.length <= 1);
    const ledger = settlements[0];
    const events = await db
      .select()
      .from(schema.paymentOperationEvents)
      .where(eq(schema.paymentOperationEvents.trancheId, this.trancheId));
    if (ledger) {
      const latest = events.filter((e) => e.key === ledger.key).sort((a, b) => b.version - a.version)[0];
      assert.equal(latest?.status, ledger.status);
      assert.equal(latest?.reference, ledger.reference);
    }
    const input = {
      authorizationId: tranche.currentHold.authorizationId,
      requestId: 'read',
      operationKey: 'read',
      amount: { currencyCode: 'USD', value: '10.00' },
    };
    const auth = (await this.transport.call('GET_AUTHORIZATION', input)).body as {
      status: string;
      supplementary_data: { related_ids: { order_id: string } };
    };
    const order = (
      await this.transport.call('GET_ORDER', {
        ...input,
        authorizationId: auth.supplementary_data.related_ids.order_id,
      })
    ).body as { purchase_units: { payments: { captures: { id: string; invoice_id: string }[] } }[] };
    const captures = order.purchase_units[0]?.payments.captures ?? [];
    assert.equal(this.captures, this.scenario.expected.captures);
    if (captures[0]) assert.equal(captures[0].invoice_id, ledger?.key);
    return {
      domainState: projected.state,
      providerState: auth.status,
      captures: captures.length,
      settlementEffect: projected.settlement?.effect ?? null,
      ledgerStatus: ledger?.status === 'CONFIRMED' || ledger?.status === 'FAILED' ? ledger.status : null,
      domainReference: projected.settlement?.reference ?? null,
      ledgerReference: ledger?.reference ?? null,
      providerReference: projected.settlement
        ? (captures[0]?.id ?? `${auth.supplementary_data.related_ids.order_id}:${tranche.currentHold.authorizationId}`)
        : null,
      simulated: true,
      moneyExecuted: false,
    };
  }
  async proof() {
    const value = await this.store.load(this.trancheId),
      tranche = restoreTrancheRecord(value.record);
    assert.equal(tranche.state, 'RELEASED');
    assert.equal(tranche.settlement?.effect, 'CAPTURE');
    assert(tranche.settlement?.reference);
    return {
      trancheId: this.trancheId,
      packageId: this.packageId,
      reference: tranche.settlement.reference,
      effect: 'CAPTURE',
      minor: 1000,
      currency: 'USD',
      simulated: true,
    };
  }
}
