import { createHmac } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { codeParams } from '../../test/fixtures/code-terms.js';
import { mandateTermsHash } from '../application/mandate-terms.js';
import { FundingStoreError } from '../ports/funding-store.js';
import type { Mandate } from '../ports/mandate-store.js';
import { MandateStoreError } from '../ports/mandate-store.js';
import { createApp } from './app.js';

const now = 1790985600000;
const key = 'fixture_platform_key';
const secret = 'fixture_signing_secret';
const draft = {
  id: 'alw_1',
  status: 'DRAFT' as const,
  payee_ref: 'builder_1',
  cap: { minor: 1000, currency: 'USD' },
  milestones: [
    { name: 'build', amount: { minor: 1000, currency: 'USD' }, profile: 'code.milestone@1', params: codeParams },
  ],
  window_days: 7,
  max_resubmits: 1,
  tranches: [{ id: 'trn_1', name: 'build' }],
};
function signed(method: string, path: string, body: string, idempotency: string) {
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
      'Idempotency-Key': idempotency,
    },
  };
}
const mandate = (over: Partial<Mandate> = {}): Mandate => ({
  key: 'm-key',
  platformId: 'platform_a',
  allowanceId: 'alw_1',
  termsVersion: 1,
  termsHash: mandateTermsHash(draft),
  customerRef: 'c'.repeat(64),
  mode: 'sim',
  status: 'AWAITING_APPROVAL',
  setupRequestId: 'setup-req',
  tokenRequestId: 'token-req',
  setupId: 'SETUP-SECRET-ID',
  customerId: 'CUSTOMER-SECRET-ID',
  payerId: null,
  tokenId: 'TOKEN-SECRET',
  approvalUrl: 'http://paypal-sim:8080/__sim/setup-approve/SETUP-1',
  version: 2,
  acceptedAt: now,
  expiresAt: now + 7 * 86400000,
  createdAt: new Date(now).toISOString(),
  ...over,
});
function fixture() {
  const mandates = {
    reserve: vi.fn(async (input: { key: string }) =>
      mandate({ key: input.key, status: 'RESERVED', approvalUrl: null }),
    ),
    load: vi.fn(async () => mandate()),
  };
  const funding = {
    reserve: vi.fn(async (input: { key: string; trancheId: string }) => ({
      key: input.key,
      trancheId: input.trancheId,
      status: 'RESERVED' as const,
      approvalUrl: null,
      hold: null,
      instruction: { platformId: 'platform_a', trancheId: input.trancheId },
    })),
    load: vi.fn(async () => ({
      key: 'f-key',
      trancheId: 'trn_1',
      status: 'HELD' as const,
      approvalUrl: null,
      hold: {
        orderId: 'ORDER-SECRET',
        authorizationId: 'AUTH-SECRET',
        heldAt: now,
        expiresAt: now + 86400000,
        reference: 'R',
      },
      instruction: { platformId: 'platform_a', trancheId: 'trn_1' },
    })),
  };
  const store = {
    create: vi.fn(),
    allowance: vi.fn(async (_p: string, id: string) => (id === 'alw_1' ? draft : null)),
    tranche: vi.fn(async () => null),
  };
  const app = createApp({
    appEnv: 'ci',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    demoMode: false,
    api: {
      store,
      platformId: 'platform_a',
      key,
      secret,
      clock: () => now,
      // biome-ignore lint/suspicious/noExplicitAny: partial fakes of the two stores
      signing: { mode: 'sim', mandates: mandates as any, funding: funding as any },
    },
  });
  return { app, mandates, funding };
}

// T-0260: a platform asks Stood to sign a saved-PayPal mandate and to fund a tranche. HTTP only records the intent;
// the worker makes every PayPal call. Responses carry status and the buyer's approval link, never tokens or PayPal ids.
it('records a mandate request against the stored terms and reports it without provider secrets', async () => {
  const { app, mandates } = fixture();
  const created = await app.request(
    '/v1/allowances/alw_1/mandate',
    signed('POST', '/allowances/alw_1/mandate', '{}', 'm-key'),
  );
  expect(created.status).toBe(202);
  expect(await created.json()).toEqual({
    key: 'm-key',
    status: 'RESERVED',
    approve_url: null,
    expires_at: now + 7 * 86400000,
  });
  expect(mandates.reserve).toHaveBeenCalledWith({
    key: 'm-key',
    platformId: 'platform_a',
    allowanceId: 'alw_1',
    termsVersion: 1,
    termsHash: mandateTermsHash(draft),
    mode: 'sim',
    acceptedAt: now,
  });
  const read = await app.request(
    '/v1/allowances/alw_1/mandate/m-key',
    signed('GET', '/allowances/alw_1/mandate/m-key', '', ''),
  );
  const body = await read.text();
  expect(JSON.parse(body)).toMatchObject({
    status: 'AWAITING_APPROVAL',
    approve_url: expect.stringContaining('setup-approve'),
  });
  expect(body).not.toMatch(/SECRET/);
  const unknown = await app.request(
    '/v1/allowances/alw_9/mandate',
    signed('POST', '/allowances/alw_9/mandate', '{}', 'x'),
  );
  expect(unknown.status).toBe(404);
  const foreign = await app.request(
    '/v1/allowances/alw_2/mandate/m-key',
    signed('GET', '/allowances/alw_2/mandate/m-key', '', ''),
  );
  expect(foreign.status).toBe(404);
  mandates.reserve.mockRejectedValueOnce(new MandateStoreError('CONFLICT'));
  const busy = await app.request(
    '/v1/allowances/alw_1/mandate',
    signed('POST', '/allowances/alw_1/mandate', '{}', 'm-2'),
  );
  expect(busy.status).toBe(409);
});

it('records a funding request for a tranche version and reports the hold without PayPal ids', async () => {
  const { app, funding } = fixture();
  const body = JSON.stringify({ expected_version: 0, nonce: 'K7Q' });
  const created = await app.request(
    '/v1/tranches/trn_1/funding',
    signed('POST', '/tranches/trn_1/funding', body, 'f-key'),
  );
  expect(created.status).toBe(202);
  expect(await created.json()).toEqual({ key: 'f-key', status: 'RESERVED', approve_url: null, hold_expires_at: null });
  expect(funding.reserve).toHaveBeenCalledWith({
    key: 'f-key',
    trancheId: 'trn_1',
    platformId: 'platform_a',
    expectedVersion: 0,
    nonce: 'K7Q',
    mode: 'sim',
  });
  const read = await app.request(
    '/v1/tranches/trn_1/funding/f-key',
    signed('GET', '/tranches/trn_1/funding/f-key', '', ''),
  );
  const text = await read.text();
  expect(JSON.parse(text)).toEqual({
    key: 'f-key',
    status: 'HELD',
    approve_url: null,
    hold_expires_at: now + 86400000,
  });
  expect(text).not.toMatch(/SECRET/);
  for (const bad of ['{}', '{"expected_version":-1,"nonce":"K7Q"}', '{"expected_version":0,"nonce":"no"}', 'x'])
    expect(
      (await app.request('/v1/tranches/trn_1/funding', signed('POST', '/tranches/trn_1/funding', bad, `bad-${bad}`)))
        .status,
    ).toBe(422);
  funding.reserve.mockRejectedValueOnce(new FundingStoreError('STALE_VERSION'));
  const stale = await app.request('/v1/tranches/trn_1/funding', signed('POST', '/tranches/trn_1/funding', body, 'f-2'));
  expect(stale.status).toBe(409);
  expect((await stale.json()).code).toBe('stale_version');
  const other = await app.request(
    '/v1/tranches/trn_2/funding/f-key',
    signed('GET', '/tranches/trn_2/funding/f-key', '', ''),
  );
  expect(other.status).toBe(404);
});
