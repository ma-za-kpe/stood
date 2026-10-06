import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createTrancheRecord } from '../domain/tranche-record.js';
import { PlatformApiStoreError } from '../ports/platform-api-store.js';
import { createApp } from './app.js';

const now = 1790985600000;
const key = 'fixture_platform_key';
const secret = 'fixture_signing_secret';
const draft = {
  payee_ref: 'builder_1',
  cap: { minor: 1000, currency: 'GBP' },
  milestones: [
    { name: 'foundation', amount: { minor: 1000, currency: 'GBP' }, profile: 'construction.stage@1', params: {} },
  ],
  window_days: 7,
  max_resubmits: 1,
};
function headers(
  body = '',
  at = now,
  options: { path?: string; method?: string; key?: string; ifMatch?: string } = {},
) {
  const timestamp = String(Math.floor(at / 1000));
  return {
    Authorization: `Bearer ${key}`,
    'Stood-Signature': `t=${timestamp},v2=${createHmac('sha256', secret)
      .update(
        JSON.stringify([
          'stood.request@2',
          timestamp,
          options.method ?? (body ? 'POST' : 'GET'),
          options.path ?? '/v1/allowances',
          options.key ?? 'fixture_key',
          options.ifMatch ?? '',
          'application/json',
          body,
        ]),
      )
      .digest('hex')}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': options.key ?? 'fixture_key',
    ...(options.ifMatch !== undefined ? { 'If-Match': options.ifMatch } : {}),
  };
}
function fixture() {
  const store = {
    create: vi.fn(async () => ({
      id: 'alw_fixture',
      status: 'DRAFT' as const,
      ...draft,
      tranches: [{ id: 'trn_fixture', name: 'foundation' }],
    })),
    allowance: vi.fn(async (): Promise<import('../ports/platform-api-store.js').StoredDraft | null> => null),
    tranche: vi.fn(async (): Promise<import('../ports/tranche-store.js').StoredTranche | null> => null),
  };
  const app = createApp({
    appEnv: 'ci',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    demoMode: true,
    api: { store, platformId: 'platform_a', key, secret, clock: () => now },
  });
  return { app, store };
}
describe('Signed platform API draft foundation', () => {
  it('rejects replay when the method, target, query, idempotency key or version header changes', async () => {
    const { app, store } = fixture();
    const body = JSON.stringify(draft),
      signed = headers(body);
    for (const [path, override] of [
      ['/v1/allowances?other=1', {}],
      ['/v1/tranches/foreign/packages', {}],
      ['/v1/allowances', { 'Idempotency-Key': 'another-key' }],
      ['/v1/allowances', { 'If-Match': '7' }],
    ] as const)
      expect((await app.request(path, { method: 'POST', body, headers: { ...signed, ...override } })).status).toBe(401);
    expect((await app.request('/v1/allowances', { method: 'GET', headers: signed })).status).toBe(401);
    expect(store.create).not.toHaveBeenCalled();
  });
  it('rejects the old body-only signature and method changes even with identical empty bodies', async () => {
    const { app, store } = fixture();
    const t = String(Math.floor(now / 1000));
    const legacy = {
      ...headers(),
      'Stood-Signature': `t=${t},v1=${createHmac('sha256', secret).update(`${t}.`).digest('hex')}`,
    };
    expect((await app.request('/v1/allowances', { headers: legacy })).status).toBe(401);
    expect((await app.request('/v1/allowances', { headers: headers('', now, { method: 'POST' }) })).status).toBe(401);
    expect(store.allowance).not.toHaveBeenCalled();
  });
  it('creates a draft with authenticated platform identity and no invented PayPal approval', async () => {
    const { app, store } = fixture();
    const body = JSON.stringify(draft);
    const response = await app.request('/v1/allowances', { method: 'POST', headers: headers(body), body });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: 'alw_fixture', status: 'DRAFT' });
    expect(store.create).toHaveBeenCalledWith(
      'platform_a',
      'fixture_key',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      draft,
    );
    expect((await app.request('/health')).status).toBe(200);
  });
  it('rejects missing, malformed, mismatched, stale or future signatures before writes', async () => {
    const { app, store } = fixture();
    const body = JSON.stringify(draft);
    for (const h of [
      {},
      { ...headers(body), Authorization: 'Bearer wrong' },
      { ...headers(body), 'Stood-Signature': 'bad' },
      headers('tampered'),
      headers(body, now - 301000),
      headers(body, now + 301000),
    ]) {
      const response = await app.request('/v1/allowances', { method: 'POST', headers: h, body });
      expect(response.status).toBe(401);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
    }
    expect(store.create).not.toHaveBeenCalled();
  });
  it('rejects missing idempotency, malformed bodies and invalid money at the boundary', async () => {
    const { app, store } = fixture();
    const body = JSON.stringify(draft);
    expect(
      (
        await app.request('/v1/allowances', {
          method: 'POST',
          body,
          headers: headers(body, now, { key: '' }),
        })
      ).status,
    ).toBe(422);
    for (const value of [
      '{',
      'null',
      JSON.stringify({ ...draft, cap: { minor: 10.5, currency: 'GBP' } }),
      JSON.stringify({ ...draft, cap: { minor: 1000, currency: 'GHS' } }),
      JSON.stringify({ ...draft, platform_id: 'other' }),
    ])
      expect(
        (await app.request('/v1/allowances', { method: 'POST', body: value, headers: headers(value) })).status,
      ).toBe(422);
    expect(store.create).not.toHaveBeenCalled();
  });
  it('requires signatures for reads, passes the tenant to storage and hides missing or foreign records', async () => {
    const { app, store } = fixture();
    for (const resource of ['allowances', 'tranches']) {
      expect((await app.request(`/v1/${resource}/foreign`)).status).toBe(401);
      expect(
        (
          await app.request(`/v1/${resource}/foreign`, {
            headers: headers('', now, { path: `/v1/${resource}/foreign` }),
          })
        ).status,
      ).toBe(404);
    }
    expect(store.allowance).toHaveBeenCalledWith('platform_a', 'foreign');
    expect(store.tranche).toHaveBeenCalledWith('platform_a', 'foreign');
  });
  it('returns stored drafts and recovered tranche state with truthful recipient copy', async () => {
    const { app, store } = fixture();
    store.allowance.mockResolvedValue({
      id: 'alw_fixture',
      status: 'DRAFT',
      ...draft,
      tranches: [{ id: 'trn_fixture', name: 'foundation' }],
    });
    expect(
      (
        await app.request('/v1/allowances/alw_fixture', {
          headers: headers('', now, { path: '/v1/allowances/alw_fixture' }),
        })
      ).status,
    ).toBe(200);
    store.tranche.mockResolvedValue({
      trancheId: 'trn_fixture',
      version: 0,
      pending: null,
      record: createTrancheRecord({
        id: 'trn_fixture',
        amount: draft.cap,
        profileId: 'construction.stage@1',
        maxResubmits: 1,
      }),
    });
    const response = await app.request('/v1/tranches/trn_fixture', {
      headers: headers('', now, { path: '/v1/tranches/trn_fixture' }),
    });
    expect(await response.json()).toMatchObject({
      state: 'PENDING',
      decision: null,
      hold: null,
      settlement: null,
      pending: null,
      sentences: { payer: 'Your stage is waiting. Nothing was paid.' },
    });
  });
  it('maps durable conflicts and contains unavailable storage without disclosing exception text', async () => {
    const { app, store } = fixture();
    const body = JSON.stringify(draft);
    store.create.mockRejectedValueOnce(new PlatformApiStoreError());
    expect((await app.request('/v1/allowances', { method: 'POST', body, headers: headers(body) })).status).toBe(409);
    store.create.mockRejectedValueOnce(new Error('private database connection'));
    const response = await app.request('/v1/allowances', { method: 'POST', body, headers: headers(body) });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private');
  });
  it('bounds request size before buffering for HMAC verification', async () => {
    const { app, store } = fixture();
    const body = 'x'.repeat(65537);
    expect((await app.request('/v1/allowances', { method: 'POST', body, headers: headers(body) })).status).toBe(413);
    expect(store.create).not.toHaveBeenCalled();
  });
  it('keeps financial and evidence writes off while allowing fixture previews', async () => {
    const { app } = fixture();
    for (const path of [
      '/v1/tranches/trn/dispatch',
      '/v1/tranches/trn/packages',
      '/v1/allowances/alw/versions',
      '/v1/tranches/trn',
      '/v1/allowances/alw',
    ])
      expect(
        (await app.request(path, { method: 'POST', body: '{}', headers: headers('{}', now, { path }) })).status,
      ).toBe(503);
    expect((await app.request('/v1/demo/scenarios/good', { method: 'POST' })).status).toBe(200);
  });
});
