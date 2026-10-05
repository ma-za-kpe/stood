import { serve } from '@hono/node-server';
import type { FaultController } from '../../../simulators/src/faults.js';
import { createPayPalSimulator } from '../../../simulators/src/paypal.js';
import { ServerSdkTransport } from '../../src/adapters/payments-paypal/sdk.js';
import type { PayPalHarness } from './paypal-transport.js';
export async function simulatorHarness(faults?: FaultController): Promise<PayPalHarness & { baseUrl: string }> {
  const h = await simulatorServer(faults);
  try {
    return { ...h, input: await h.seed('fixture-tranche') };
  } catch (error) {
    await h.close();
    throw error;
  }
}
export async function simulatorServer(faults?: FaultController) {
  let now = Date.parse('2026-10-05T00:00:00Z');
  const sim = createPayPalSimulator({ environment: 'ci', clock: () => now, ...(faults ? { faults } : {}) });
  const server = serve({ fetch: sim.app.fetch, hostname: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Simulator did not bind');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let seeds = 0;
  let closed = false;
  const seed = async (trancheId: string) => {
    const n = ++seeds;
    const headers = {
      Authorization: 'Bearer sim-access-token',
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `seed-order-${n}`,
    };
    const order = (await (
      await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          intent: 'AUTHORIZE',
          purchase_units: [{ custom_id: trancheId, amount: { currency_code: 'USD', value: '10.00' } }],
        }),
      })
    ).json()) as { id: string };
    const approval = await fetch(`${baseUrl}/__sim/approve/${order.id}`, { method: 'POST', headers, body: '{}' });
    if (!approval.ok) throw new Error('Synthetic approval failed');
    const authorized = (await (
      await fetch(`${baseUrl}/v2/checkout/orders/${order.id}/authorize`, {
        method: 'POST',
        headers: { ...headers, 'PayPal-Request-Id': `seed-auth-${n}` },
        body: '{}',
      })
    ).json()) as { purchase_units: { payments: { authorizations: { id: string }[] } }[] };
    return {
      authorizationId: authorized.purchase_units[0]?.payments.authorizations[0]?.id ?? '',
      requestId: 'contract-request',
      operationKey: 'contract-operation',
      amount: { currencyCode: 'USD', value: '10.00' },
    };
  };
  return {
    baseUrl,
    seed,
    events: sim.events,
    deliver: sim.deliver,
    transport: new ServerSdkTransport({
      appEnv: 'ci',
      mode: 'sim',
      baseUrl,
      clientId: 'sim-client',
      clientSecret: 'sim-secret',
    }),
    advance: (days: number) => {
      now += days * 86400000;
    },
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve, reject) => {
        if ('closeAllConnections' in server) server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
