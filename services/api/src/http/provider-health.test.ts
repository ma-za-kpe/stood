import { expect, it } from 'vitest';
import { bootProviders } from '../application/provider-registry.js';
import { createApp } from './app.js';

it('reports selected simulation modes without claiming payment activation', async () => {
  const registry = await bootProviders({
    environment: 'ci',
    selections: { paypal: 'sim' },
    keys: {},
    definitions: [
      {
        id: 'paypal',
        requiredKeys: [],
        factories: { sim: async () => ({ adapter: {}, ready: async () => true }) },
      },
    ],
  });
  const app = createApp({
    appEnv: 'ci',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    demoMode: true,
    providerHealth: registry.health,
  });
  const body = await (await app.request('/health')).json();
  expect(body.providers).toEqual([{ provider: 'paypal', mode: 'sim', simulated: true, ready: true }]);
  expect(body.paymentReady).toBe(false);
});
