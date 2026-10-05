import { serve } from '@hono/node-server';
import { expect, it } from 'vitest';
import { createPayPalSimulator } from '../../../../simulators/src/paypal.js';
import { type PayPalHarness, paypalTransportContract } from '../../../test/contracts/paypal-transport.js';
import { ServerSdkTransport } from './sdk.js';
export async function simulatorHarness(): Promise<PayPalHarness & { baseUrl: string }> {
  let now = Date.parse('2026-10-05T00:00:00Z');
  const sim = createPayPalSimulator({ environment: 'ci', clock: () => now });
  const server = serve({ fetch: sim.app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Simulator did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const headers = {
    Authorization: 'Bearer sim-access-token',
    'Content-Type': 'application/json',
    'PayPal-Request-Id': 'seed-order',
  };
  const order = (await (
    await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        intent: 'AUTHORIZE',
        purchase_units: [{ custom_id: 'fixture-tranche', amount: { currency_code: 'USD', value: '10.00' } }],
      }),
    })
  ).json()) as { id: string };
  sim.approve(order.id);
  const authorized = (await (
    await fetch(`${baseUrl}/v2/checkout/orders/${order.id}/authorize`, {
      method: 'POST',
      headers: { ...headers, 'PayPal-Request-Id': 'seed-auth' },
      body: '{}',
    })
  ).json()) as { purchase_units: { payments: { authorizations: { id: string }[] } }[] };
  const input = {
    authorizationId: authorized.purchase_units[0]?.payments.authorizations[0]?.id ?? '',
    requestId: 'contract-request',
    operationKey: 'contract-operation',
    amount: { currencyCode: 'USD', value: '10.00' },
  };
  return {
    baseUrl,
    input,
    transport: new ServerSdkTransport({
      appEnv: 'ci',
      mode: 'sim',
      baseUrl,
      clientId: 'sim-client',
      clientSecret: 'sim-secret',
    }),
    advance: (days) => {
      now += days * 86400000;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        if ('closeAllConnections' in server) server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
paypalTransportContract('real pinned SDK over simulator HTTP', simulatorHarness);
it('refuses simulator redirects in provider mode and real credentials in simulator mode', () => {
  const c = {
    appEnv: 'ci',
    mode: 'sim' as const,
    baseUrl: 'http://127.0.0.1:8080',
    clientId: 'sim-client',
    clientSecret: 'sim-secret',
  };
  for (const patch of [
    { appEnv: 'production' },
    { mode: 'live' },
    { baseUrl: 'http://example.com' },
    { baseUrl: 'http://127.0.0.1.attacker.test' },
    { baseUrl: 'http://127.0.0.1:80/path' },
    { clientSecret: 'real-secret' },
  ])
    expect(() => new ServerSdkTransport({ ...c, ...patch })).toThrow();
});
