import { describe, expect, it } from 'vitest';
import { PAYMENT_KEYS, QUALIFICATION_GUIDANCE, SETUP_GUIDANCE } from '../application/payment-readiness.js';
import { createApp } from './app.js';

const config = { appEnv: 'local', paypalBaseUrl: 'https://api-m.sandbox.paypal.com', demoMode: false };
describe('Payment readiness', () => {
  it('lists only missing names and gives the same guidance for money routes', async () => {
    const app = createApp({
      ...config,
      paymentKeys: { PAYPAL_CLIENT_ID: 'fixture_client', PAYPAL_CLIENT_SECRET: ' ' },
    });
    const payload = await (await app.request('/health')).json();
    expect(payload.missing).toEqual(PAYMENT_KEYS.filter((key) => key !== 'PAYPAL_CLIENT_ID'));
    expect(payload.sentence).toBe(SETUP_GUIDANCE);
    expect(JSON.stringify(payload)).not.toContain('fixture_client');
    for (const path of ['/v1/allowances', '/v1/tranches/example/settle', '/v1/payments']) {
      const response = await app.request(path, { method: 'POST' });
      expect(response.status).toBe(503);
      expect(response.headers.get('content-type')).toContain('application/problem+json');
      expect(await response.json()).toMatchObject({ code: 'payments_not_configured', detail: SETUP_GUIDANCE });
    }
  });
  it('keeps payments off even with every variable supplied, and leaves demo fixtures available', async () => {
    const paymentKeys = Object.fromEntries(PAYMENT_KEYS.map((key) => [key, 'fixture_value']));
    const app = createApp({ ...config, demoMode: true, paymentKeys });
    // Keys present is not the same as qualified: say so, instead of sending operators back to setup (T-0248).
    expect(await (await app.request('/health')).json()).toMatchObject({
      paymentReady: false,
      missing: [],
      sentence: QUALIFICATION_GUIDANCE,
    });
    const refused = await app.request('/v1/allowances', { method: 'POST' });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toMatchObject({ code: 'payments_not_qualified', detail: QUALIFICATION_GUIDANCE });
    expect(QUALIFICATION_GUIDANCE).not.toContain('scripts/dev setup');
    expect((await app.request('/v1/demo/scenarios/good', { method: 'POST' })).status).toBe(200);
  });
});

// T-0261: payments are reported on only when they can really run on the sandbox: every key set, the real PayPal
// sandbox connected and ready, and saved-account signing and funding wired. Nothing else turns the flag on.
it('earns paymentReady from keys, a ready real sandbox and wired signing, and names what is missing', async () => {
  const keys = Object.fromEntries(
    [
      'PAYPAL_CLIENT_ID',
      'PAYPAL_CLIENT_SECRET',
      'PAYPAL_WEBHOOK_ID',
      'STOOD_API_KEY',
      'STOOD_HMAC_SECRET',
      'STOOD_WEBHOOK_SECRET',
    ].map((k) => [k, 'set']),
  );
  const paypal = (over: object = {}) => [{ provider: 'paypal', mode: 'live', simulated: false, ready: true, ...over }];
  const signing = { mode: 'live' as const, mandates: {} as never, funding: {} as never };
  const api = { store: {} as never, platformId: 'p', key: 'k', secret: 's', clock: () => 1 };
  const health = async (config: object) =>
    (
      await createApp({
        appEnv: 'demo',
        paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
        demoMode: true,
        paymentKeys: keys,
        // biome-ignore lint/suspicious/noExplicitAny: provider health fixtures
        providerHealth: () => paypal() as any,
        api: { ...api, signing },
        ...config,
      }).request('/health')
    ).json();
  expect(await health({})).toMatchObject({
    paymentReady: true,
    sentence:
      'Sandbox payments are on: PayPal sandbox connected, saved-account signing and funding wired. No real money.',
  });
  expect(await health({ api })).toMatchObject({
    paymentReady: false,
    sentence: 'Payments are off: saved-account signing and funding need VAULT_TOKEN_KEYS. See docs/SETUP.md.',
  });
  // biome-ignore lint/suspicious/noExplicitAny: provider health fixtures
  for (const over of [{ ready: false }, { simulated: true }, { mode: 'sim' }])
    expect(await health({ providerHealth: () => paypal(over) as any })).toMatchObject({ paymentReady: false });
  expect(await health({ paymentKeys: { ...keys, PAYPAL_WEBHOOK_ID: '' } })).toMatchObject({ paymentReady: false });
});
