import { PayPalWebhookVerifier } from './adapters/payments-paypal/webhook-verifier.js';

type Event = Readonly<{ id: string; event_type: string; resource: unknown; simulated?: true }>;

// Live PayPal webhooks for stood-api: PayPal verifies each delivery, then it is stored once as a hint (T-0033).
// Off unless PROVIDER_PAYPAL=live and every setting is present; the route then answers webhooks_not_configured.
export function paypalWebhookReceiver(
  env: Readonly<Record<string, string | undefined>>,
  deps: Readonly<{
    store: { enqueue(event: Event): Promise<void> };
    transport: (request: Request) => Promise<Response>;
    clock: () => number;
  }>,
) {
  const settings = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'].map((k) => env[k]?.trim() ?? '');
  if (env.PROVIDER_PAYPAL !== 'live' || settings.some((v) => !v)) return undefined;
  const [clientId = '', clientSecret = '', webhookId = ''] = settings;
  const verifier = new PayPalWebhookVerifier({
    baseUrl: env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com',
    clientId,
    clientSecret,
    webhookId,
    transport: deps.transport,
    clock: deps.clock,
  });
  return {
    verify: (body: string, headers: Headers) => verifier.verify(body, headers),
    enqueue: (event: Event) => deps.store.enqueue(event),
  };
}
