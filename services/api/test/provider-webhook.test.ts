import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { deliverSimulatedWebhook } from '../../simulators/src/webhooks.js';
import { createApp } from '../src/http/app.js';

it('delivers signed simulated events to Stood as reconciliation hints, never settlement confirmations', async () => {
  const enqueue = vi.fn(async () => {});
  const now = 1791158400000;
  const app = createApp({
    appEnv: 'ci',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    demoMode: false,
    providerEvents: {
      verify: async (body, headers) =>
        headers.get('Stood-Sim-Signature') ===
        `t=${now / 1000},v1=${createHmac('sha256', 'sim-webhook-secret')
          .update(`${now / 1000}.${body}`)
          .digest('hex')}`,
      enqueue,
    },
  });
  const event = { id: 'SIM-EVENT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'SIM-CAPTURE' } };
  await deliverSimulatedWebhook({
    url: 'http://127.0.0.1:3000/v1/webhooks/paypal',
    clock: () => now,
    event,
    transport: async (request) => app.fetch(request),
  });
  expect(enqueue).toHaveBeenCalledWith({ ...event, simulated: true });
  expect((await app.request('/v1/webhooks/paypal', { method: 'POST', body: JSON.stringify(event) })).status).toBe(401);
  expect(enqueue).toHaveBeenCalledTimes(1);
  expect((await (await app.request('/health')).json()).paymentReady).toBe(false);
});
describe('Simulated webhook destinations', () => {
  it.each([
    'https://api-m.sandbox.paypal.com/v1/webhooks/paypal',
    'http://example.com/v1/webhooks/paypal',
    'http://127.0.0.1:3000/other',
    'http://user:pass@127.0.0.1:3000/v1/webhooks/paypal',
  ])('rejects %s', async (url) => {
    const transport = vi.fn();
    await expect(deliverSimulatedWebhook({ url, clock: () => 0, event: {}, transport })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

it('rejects non-boolean verification and array resources without enqueueing a hint', async () => {
  const enqueue = vi.fn(async () => {});
  const verify = vi.fn(async (): Promise<boolean> => 'true' as unknown as boolean);
  const app = createApp({
    appEnv: 'ci',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    demoMode: false,
    providerEvents: { verify, enqueue },
  });
  const event = { id: 'SIM-EVENT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'SIM-CAPTURE' } };
  expect((await app.request('/v1/webhooks/paypal', { method: 'POST', body: JSON.stringify(event) })).status).toBe(401);
  verify.mockResolvedValue(true);
  expect(
    (await app.request('/v1/webhooks/paypal', { method: 'POST', body: JSON.stringify({ ...event, resource: [] }) }))
      .status,
  ).toBe(422);
  expect(enqueue).not.toHaveBeenCalled();
});
