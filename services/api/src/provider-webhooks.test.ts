import { describe, expect, it } from 'vitest';
import { createApp } from './http/app.js';
import { paypalWebhookReceiver } from './provider-webhooks.js';

const env = {
  PROVIDER_PAYPAL: 'live',
  PAYPAL_BASE_URL: 'https://api-m.sandbox.paypal.com',
  PAYPAL_CLIENT_ID: 'client',
  PAYPAL_CLIENT_SECRET: 'secret',
  PAYPAL_WEBHOOK_ID: 'WEBHOOK-ID',
};
const event = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-1' } };
const delivery = {
  'paypal-transmission-id': 'tx-1',
  'paypal-transmission-time': '2026-10-08T01:00:00Z',
  'paypal-transmission-sig': 'c2ln',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
  'paypal-auth-algo': 'SHA256withRSA',
};
function receiver(verdict: () => Response) {
  const stored: unknown[] = [];
  const events = paypalWebhookReceiver(env, {
    store: { enqueue: async (e) => void stored.push(e) },
    transport: async (request) =>
      request.url.endsWith('/v1/oauth2/token') ? Response.json({ access_token: 't', expires_in: 32400 }) : verdict(),
    clock: () => 0,
  });
  const app = createApp({
    appEnv: 'demo',
    paypalBaseUrl: env.PAYPAL_BASE_URL,
    demoMode: false,
    providerMode: 'live',
    ...(events ? { providerEvents: events } : {}),
  });
  const post = (body = JSON.stringify(event)) =>
    app.request('/v1/webhooks/paypal', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', ...delivery },
    });
  return { events, stored, post };
}

describe('Production PayPal webhook receiver wiring (T-0033)', () => {
  it('accepts a delivery PayPal verifies, and stores it as a hint', async () => {
    const r = receiver(() => Response.json({ verification_status: 'SUCCESS' }));
    expect((await r.post()).status).toBe(202);
    expect(r.stored).toEqual([event]);
  });
  it('refuses what PayPal does not verify, and asks PayPal to retry during an outage', async () => {
    const refused = receiver(() => Response.json({ verification_status: 'FAILURE' }));
    expect((await refused.post()).status).toBe(401);
    const down = receiver(() => Response.json({ debug_id: 'dbg' }, { status: 503 }));
    expect((await down.post()).status).toBe(503);
    expect([...refused.stored, ...down.stored]).toEqual([]);
  });
  it('stays off unless live sandbox mode has every webhook setting', () => {
    const deps = { store: { enqueue: async () => {} }, transport: fetch, clock: Date.now };
    expect(paypalWebhookReceiver({ ...env, PROVIDER_PAYPAL: 'sim' }, deps)).toBeUndefined();
    expect(paypalWebhookReceiver({ ...env, PAYPAL_WEBHOOK_ID: '' }, deps)).toBeUndefined();
    expect(paypalWebhookReceiver({ ...env, PAYPAL_CLIENT_SECRET: undefined }, deps)).toBeUndefined();
    expect(paypalWebhookReceiver(env, deps)).toBeDefined();
  });
});
