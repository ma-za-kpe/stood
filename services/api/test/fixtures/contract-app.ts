import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { vi } from 'vitest';
import { usageAuthorities } from '../../src/application/usage-intake.js';
import { decide, getProfile } from '../../src/domain/decision.js';
import { createTrancheRecord } from '../../src/domain/tranche-record.js';
import { receiptPayload } from '../../src/domain/usage-receipt.js';
import { createApp } from '../../src/http/app.js';
import { MemoryTranches } from '../fakes/tranche-store.js';
import { codeParams } from './code-terms.js';

// T-0053: the real Stood router with in-memory stores, used by the contract tests and the generated-SDK check.
export const now = 1790985600000;
export const key = 'contract-key';
export const secret = 'contract-secret';
export const draft = {
  payee_ref: 'builder_1',
  cap: { minor: 1000, currency: 'USD' },
  milestones: [
    { name: 'build', amount: { minor: 1000, currency: 'USD' }, profile: 'code.milestone@1', params: codeParams },
  ],
  window_days: 7,
  max_resubmits: 1,
};
const stored = { id: 'alw_1', status: 'DRAFT' as const, ...draft, tranches: [{ id: 'trn_1', name: 'build' }] };
export const pkg = {
  repository: 'owner/app',
  base_commit: 'a'.repeat(40),
  commit_sha: 'b'.repeat(40),
  report_ref: 'reports/run.json',
  report_sha256: 'c'.repeat(64),
};
export function signed(method: string, path: string, body = '', idempotency = '') {
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
const usageKeys = generateKeyPairSync('ed25519');
const authorities = usageAuthorities(
  JSON.stringify([
    {
      keyId: 'yard-usage-1',
      root: 'yard-buyers',
      publicKey: Buffer.from(usageKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString()).toString('base64'),
    },
  ]),
);
// A usage receipt for the fixture's final package, signed by the configured authority.
export function usageReceipt(nonce = 'nonce-contract-000001') {
  const unsigned = {
    version: 1 as const,
    allowanceId: 'alw_1',
    trancheId: 'trn_1',
    commit: pkg.commit_sha,
    authority: { keyId: 'yard-usage-1', root: 'yard-buyers' },
    observedAt: now - 1000,
    nonce,
  };
  return {
    ...unsigned,
    signature: sign(null, Buffer.from(receiptPayload(unsigned)), usageKeys.privateKey).toString('base64'),
  };
}
export async function harness() {
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
  const baselineView = {
    id: 'bl_1',
    status: 'DONE' as const,
    terms: codeParams,
    result: {
      tests: codeParams.testIds.map((id) => ({ id, status: 'FAIL' as const })),
      evidence: { key: `baselines/platform_a/bl_1/${'e'.repeat(64)}`, sha256: 'e'.repeat(64) },
    },
    createdAt: new Date(now).toISOString(),
    finishedAt: new Date(now + 60000).toISOString(),
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
      usage: {
        authorities,
        store: {
          target: vi.fn(async (_p: string, id: string) =>
            id === 'trn_1' ? { allowanceId: 'alw_1', commit: pkg.commit_sha } : null,
          ),
          byNonce: vi.fn(async () => null),
          record: vi.fn(async (_p: string, r: { trancheId: string; commit: string; nonce: string }) => ({
            trancheId: r.trancheId,
            commit: r.commit,
            nonce: r.nonce,
            acceptedAt: new Date(now).toISOString(),
          })),
          find: vi.fn(async () => null),
        },
      },
      baselines: {
        request: vi.fn(async () => baselineView),
        get: vi.fn(async (_p: string, id: string) => (id === 'bl_1' ? baselineView : null)),
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
