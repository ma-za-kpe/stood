import { describe, expect, it } from 'vitest';
import { PayPalWebhookVerifier } from './webhook-verifier.js';

const event = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-1' } };
const raw = JSON.stringify(event);
const delivery = () =>
  new Headers({
    'paypal-transmission-id': 'tx-1',
    'paypal-transmission-time': '2026-10-08T01:00:00Z',
    'paypal-transmission-sig': 'c2lnbmF0dXJl',
    'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
    'paypal-auth-algo': 'SHA256withRSA',
  });
function harness(verification: () => Response) {
  const calls: { url: string; body: string; headers: Headers }[] = [];
  const transport = async (request: Request) => {
    calls.push({ url: request.url, body: await request.text(), headers: request.headers });
    if (request.url.endsWith('/v1/oauth2/token'))
      return Response.json({ access_token: 'sandbox-token', expires_in: 32400 });
    return verification();
  };
  const verifier = new PayPalWebhookVerifier({
    baseUrl: 'https://api-m.sandbox.paypal.com',
    clientId: 'client',
    clientSecret: 'secret',
    webhookId: 'WEBHOOK-ID',
    transport,
    clock: () => 1791418800000,
  });
  return { verifier, calls };
}

describe('PayPal webhook signature verification (T-0033)', () => {
  it('asks PayPal to verify the exact delivery and accepts only SUCCESS', async () => {
    const ok = harness(() => Response.json({ verification_status: 'SUCCESS' }));
    expect(await ok.verifier.verify(raw, delivery())).toBe(true);
    const check = ok.calls.find((c) => c.url.endsWith('/v1/notifications/verify-webhook-signature'));
    expect(check?.headers.get('Authorization')).toBe('Bearer sandbox-token');
    expect(check?.headers.get('PayPal-Request-Id')).toBeTruthy();
    expect(JSON.parse(check?.body ?? '{}')).toEqual({
      auth_algo: 'SHA256withRSA',
      cert_url: 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
      transmission_id: 'tx-1',
      transmission_sig: 'c2lnbmF0dXJl',
      transmission_time: '2026-10-08T01:00:00Z',
      webhook_id: 'WEBHOOK-ID',
      webhook_event: event,
    });
    const refused = harness(() => Response.json({ verification_status: 'FAILURE' }));
    expect(await refused.verifier.verify(raw, delivery())).toBe(false);
  });

  it('refuses incomplete or foreign deliveries without calling PayPal', async () => {
    for (const change of [
      (h: Headers) => h.delete('paypal-transmission-sig'),
      (h: Headers) => h.delete('paypal-auth-algo'),
      (h: Headers) => h.set('paypal-cert-url', 'https://evil.example/certs/CERT-1'),
      (h: Headers) => h.set('paypal-cert-url', 'http://api.sandbox.paypal.com/v1/notifications/certs/CERT-1'),
      (h: Headers) => h.set('paypal-cert-url', 'https://paypal.com.evil.example/c'),
    ]) {
      const h = harness(() => Response.json({ verification_status: 'SUCCESS' }));
      const headers = delivery();
      change(headers);
      expect(await h.verifier.verify(raw, headers)).toBe(false);
      expect(h.calls).toEqual([]);
    }
    const h = harness(() => Response.json({ verification_status: 'SUCCESS' }));
    expect(await h.verifier.verify('not json', delivery())).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('reuses one cached token across verifications', async () => {
    const h = harness(() => Response.json({ verification_status: 'SUCCESS' }));
    await h.verifier.verify(raw, delivery());
    await h.verifier.verify(raw, delivery());
    expect(h.calls.filter((c) => c.url.endsWith('/v1/oauth2/token'))).toHaveLength(1);
  });

  it('throws on PayPal outages so the route answers 503 and PayPal retries', async () => {
    for (const status of [429, 500, 503]) {
      const h = harness(() => Response.json({ debug_id: 'dbg-1' }, { status }));
      await expect(h.verifier.verify(raw, delivery())).rejects.toThrow('dbg-1');
    }
  });

  it('only ever talks to the PayPal sandbox and needs every setting', () => {
    const base = { clientId: 'c', clientSecret: 's', webhookId: 'w', transport: fetch, clock: Date.now };
    expect(() => new PayPalWebhookVerifier({ ...base, baseUrl: 'https://api-m.paypal.com' })).toThrow('Sandbox');
    expect(
      () => new PayPalWebhookVerifier({ ...base, baseUrl: 'https://api-m.sandbox.paypal.com', webhookId: ' ' }),
    ).toThrow('Sandbox');
  });
});
