import { describe, expect, it } from 'vitest';
import { PAYMENT_KEYS, SETUP_GUIDANCE } from '../application/payment-readiness.js';
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
    expect(await (await app.request('/health')).json()).toMatchObject({ paymentReady: false, missing: [] });
    expect((await app.request('/v1/allowances', { method: 'POST' })).status).toBe(503);
    expect((await app.request('/v1/demo/scenarios/good', { method: 'POST' })).status).toBe(200);
  });
});
