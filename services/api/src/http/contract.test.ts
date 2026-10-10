import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { MemoryTranches } from '../../test/fakes/tranche-store.js';
import { codeParams } from '../../test/fixtures/code-terms.js';
import { decide, getProfile } from '../domain/decision.js';
import { createTrancheRecord } from '../domain/tranche-record.js';
import { createApp } from './app.js';
import {
  Allowance,
  AllowanceDraft,
  CommitPackage,
  CommitPackageInput,
  Funding,
  FundingRequest,
  Mandate,
  openApiDocument,
  operations,
  Problem,
  Tranche,
} from './contract.js';
import { platformApi } from './platform-api.js';

const now = 1790985600000;
const key = 'contract-key';
const secret = 'contract-secret';
const draft = {
  payee_ref: 'builder_1',
  cap: { minor: 1000, currency: 'USD' },
  milestones: [
    { name: 'build', amount: { minor: 1000, currency: 'USD' }, profile: 'code.milestone@1', params: codeParams },
  ],
  window_days: 7,
  max_resubmits: 1,
};
const stored = { id: 'alw_1', status: 'DRAFT' as const, ...draft, tranches: [{ id: 'trn_1', name: 'build' }] };
const pkg = {
  repository: 'owner/app',
  base_commit: 'a'.repeat(40),
  commit_sha: 'b'.repeat(40),
  report_ref: 'reports/run.json',
  report_sha256: 'c'.repeat(64),
};
function signed(method: string, path: string, body = '', idempotency = '') {
  const t = String(Math.floor(now / 1000));
  return {
    method,
    ...(body ? { body } : {}),
    headers: {
      Authorization: `Bearer ${key}`,
      'Stood-Signature': `t=${t},v2=${createHmac('sha256', secret)
        .update(JSON.stringify(['stood.request@2', t, method, `/v1${path}`, idempotency, '', 'application/json', body]))
        .digest('hex')}`,
      'Content-Type': 'application/json',
      ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
    },
  };
}
async function harness() {
  const tranches = new MemoryTranches();
  await tranches.create(
    createTrancheRecord({ id: 'trn_1', amount: draft.cap, profileId: 'code.milestone@1', maxResubmits: 1 }),
  );
  const held = await tranches.load('trn_1');
  await tranches.apply('trn_1', held.version, 'dispatch', {
    method: 'dispatch',
    args: ['auth_1', 'K7Q', now - 1000, now + 28 * 86400000],
  });
  const reading = await tranches.load('trn_1');
  const deciding = await tranches.apply('trn_1', reading.version, 'start', { method: 'startDeciding', args: [] });
  const refusal = decide(
    'code.milestone@1',
    getProfile('code.milestone@1').checks.map(({ code }) => ({
      code,
      source: 'RULE' as const,
      status: code === 'test_integrity' ? ('FAIL' as const) : ('PASS' as const),
      reason: 'contract',
      ...(code === 'test_integrity' ? { namedField: 'tests_failed' } : {}),
    })),
  );
  await tranches.apply('trn_1', deciding.version, 'run:pkg_1', {
    method: 'beginSettlement',
    args: [refusal, 'run:pkg_1', now],
  });
  const packageView = {
    id: 'pkg_1',
    trancheId: 'trn_1',
    status: 'QUEUED' as const,
    waitingFor: 'RUNNER' as const,
    metadata: pkg,
    createdAt: new Date(now).toISOString(),
  };
  const app = createApp({
    appEnv: 'ci',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    demoMode: false,
    api: {
      store: {
        create: vi.fn(async () => stored),
        allowance: vi.fn(async (_p: string, id: string) => (id === 'alw_1' ? stored : null)),
        tranche: vi.fn(async (_p: string, id: string) => (id === 'trn_1' ? tranches.load('trn_1') : null)),
      },
      packages: {
        submit: vi.fn(async () => packageView),
        get: vi.fn(async (_p: string, _t: string, id: string) => (id === 'pkg_1' ? packageView : null)),
        latest: vi.fn(async () => packageView),
      },
      signing: {
        mode: 'live',
        mandates: {
          reserve: vi.fn(async (input: { key: string }) => ({
            key: input.key,
            platformId: 'platform_a',
            allowanceId: 'alw_1',
            status: 'RESERVED',
            approvalUrl: null,
            expiresAt: now + 86400000,
          })),
          load: vi.fn(async () => ({
            key: 'm-key',
            platformId: 'platform_a',
            allowanceId: 'alw_1',
            status: 'AWAITING_APPROVAL',
            approvalUrl: 'https://www.sandbox.paypal.com/agreements/approve?ba_token=fake',
            expiresAt: now + 86400000,
          })),
        },
        funding: {
          reserve: vi.fn(async (input: { key: string; trancheId: string }) => ({
            key: input.key,
            trancheId: input.trancheId,
            status: 'RESERVED',
            approvalUrl: null,
            hold: null,
            instruction: { platformId: 'platform_a' },
          })),
          load: vi.fn(async () => ({
            key: 'f-key',
            trancheId: 'trn_1',
            status: 'HELD',
            approvalUrl: null,
            hold: { expiresAt: now + 86400000 },
            instruction: { platformId: 'platform_a' },
          })),
        },
      },
      platformId: 'platform_a',
      key,
      secret,
      clock: () => now,
    } as never,
  });
  return app;
}
async function check(response: Response, status: number, schema: z.ZodType) {
  expect(response.status).toBe(status);
  return schema.parse(await response.json());
}

// T-0053: the OpenAPI document is generated from the Zod contract, and the real router is held to it.
describe('Stood API contract', () => {
  it('commits exactly the document the contract generates', () => {
    const committed = readFileSync(new URL('../../../../openapi/stood.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(openApiDocument(), null, 2)}\n`);
  });

  it('describes every route the router serves, and no route it does not', () => {
    const app = platformApi({
      store: { create: vi.fn(), allowance: vi.fn(), tranche: vi.fn() },
      platformId: 'p',
      key: 'k',
      secret: 's',
      clock: () => now,
    });
    const served = new Set(
      app.routes
        .filter((r) => r.method !== 'ALL')
        .map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, '{$1}')}`),
    );
    expect(new Set(operations.map((op) => `${op.method} ${op.path}`))).toEqual(served);
    const doc = openApiDocument();
    for (const op of operations) expect(doc.paths[op.path]?.[op.method]).toMatchObject({ operationId: op.id });
    expect(doc.openapi).toBe('3.1.0');
  });

  it('every response the router gives matches its documented schema', async () => {
    const app = await harness();
    const body = JSON.stringify(draft);
    await check(await app.request('/v1/allowances', signed('POST', '/allowances', body, 'k1')), 201, Allowance);
    await check(await app.request('/v1/allowances/alw_1', signed('GET', '/allowances/alw_1')), 200, Allowance);
    await check(
      await app.request('/v1/allowances/alw_1/mandate', signed('POST', '/allowances/alw_1/mandate', '{}', 'm-key')),
      202,
      Mandate,
    );
    await check(
      await app.request('/v1/allowances/alw_1/mandate/m-key', signed('GET', '/allowances/alw_1/mandate/m-key')),
      200,
      Mandate,
    );
    const tranche = (await check(
      await app.request('/v1/tranches/trn_1', signed('GET', '/tranches/trn_1')),
      200,
      Tranche,
    )) as z.infer<typeof Tranche>;
    expect(tranche).toMatchObject({ state: 'VOID_PENDING', decision: { outcome: 'REFUSE' }, package_id: 'pkg_1' });
    expect(tranche.hold).not.toBeNull();
    const funding = JSON.stringify({ expected_version: 0, nonce: 'K7Q' });
    await check(
      await app.request('/v1/tranches/trn_1/funding', signed('POST', '/tranches/trn_1/funding', funding, 'f-key')),
      202,
      Funding,
    );
    await check(
      await app.request('/v1/tranches/trn_1/funding/f-key', signed('GET', '/tranches/trn_1/funding/f-key')),
      200,
      Funding,
    );
    await check(
      await app.request(
        '/v1/tranches/trn_1/packages',
        signed('POST', '/tranches/trn_1/packages', JSON.stringify(pkg), 'p-key'),
      ),
      202,
      CommitPackage,
    );
    await check(
      await app.request('/v1/tranches/trn_1/packages/pkg_1', signed('GET', '/tranches/trn_1/packages/pkg_1')),
      200,
      CommitPackage,
    );
    for (const [path, status] of [
      ['/allowances/missing', 404],
      ['/tranches/missing', 404],
    ] as const)
      await check(await app.request(`/v1${path}`, signed('GET', path)), status, Problem);
    await check(await app.request('/v1/tranches/trn_1', { headers: {} }), 401, Problem);
  });

  it('accepts and refuses the same request bodies the router does', async () => {
    const app = await harness();
    expect(AllowanceDraft.safeParse(draft).success).toBe(true);
    expect(FundingRequest.safeParse({ expected_version: 0, nonce: 'K7Q' }).success).toBe(true);
    expect(CommitPackageInput.safeParse(pkg).success).toBe(true);
    const refused: [string, string, unknown, z.ZodType][] = [
      ['/allowances', 'a', { ...draft, extra: 1 }, AllowanceDraft],
      ['/allowances', 'b', { ...draft, cap: { minor: 1.5, currency: 'USD' } }, AllowanceDraft],
      ['/tranches/trn_1/funding', 'c', { expected_version: -1, nonce: 'K7Q' }, FundingRequest],
      ['/tranches/trn_1/funding', 'd', { expected_version: 0, nonce: 'K71' }, FundingRequest],
      ['/tranches/trn_1/packages', 'e', { ...pkg, commit_sha: 'main' }, CommitPackageInput],
      ['/tranches/trn_1/packages', 'f', { ...pkg, extra: 'x' }, CommitPackageInput],
    ];
    for (const [path, idem, value, schema] of refused) {
      expect(schema.safeParse(value).success, `${path} ${idem}`).toBe(false);
      const response = await app.request(`/v1${path}`, signed('POST', path, JSON.stringify(value), idem));
      expect(response.status, `${path} ${idem}`).toBe(422);
      Problem.parse(await response.json());
    }
  });
});
