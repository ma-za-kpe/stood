import { createHmac } from 'node:crypto';

// This is deliberately NOT PayPal's RSA signature. Live verification must never accept it.
export async function deliverSimulatedWebhook(config: {
  url: string;
  clock(): number;
  event: unknown;
  transport?: (request: Request) => Promise<Response>;
}): Promise<void> {
  const target = new URL(config.url);
  const now = config.clock();
  if (
    target.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]', 'api'].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    target.pathname !== '/v1/webhooks/paypal' ||
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !config.event ||
    typeof config.event !== 'object' ||
    Array.isArray(config.event)
  )
    throw new Error('Invalid simulated webhook configuration');
  const body = JSON.stringify({ ...config.event, simulated: true });
  if (Buffer.byteLength(body) > 65536) throw new Error('Simulated webhook is too large');
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac('sha256', 'sim-webhook-secret').update(`${timestamp}.${body}`).digest('hex');
  const response = await (config.transport ?? fetch)(
    new Request(target, {
      method: 'POST',
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(2000),
      headers: {
        'Content-Type': 'application/json',
        'X-Stood-Simulated': 'true',
        'Stood-Sim-Signature': `t=${timestamp},v1=${signature}`,
      },
    }),
  );
  if (!response.ok || response.redirected) throw new Error('Simulated webhook was not accepted');
}
