import { expect, it } from 'vitest';
import { providerRuntime } from '../src/provider-runtime.js';
import { simulatorHarness } from './contracts/paypal-simulator.js';

it('boots the actual SDK simulator adapter with shared time and never forwards configured provider keys', async () => {
  const h = await simulatorHarness();
  try {
    const runtime = await providerRuntime({
      APP_ENV: 'ci',
      PROVIDER_PAYPAL: 'sim',
      PAYPAL_SIM_URL: h.baseUrl,
      PAYPAL_CLIENT_ID: 'must-not-forward',
      PAYPAL_CLIENT_SECRET: 'must-not-forward',
    });
    expect(runtime.health()).toEqual([{ provider: 'paypal', mode: 'sim', simulated: true, ready: true }]);
    expect(runtime.transport).toBeDefined();
    const at = await runtime.clock();
    h.advance(4);
    expect(await runtime.clock()).toBe(at + 4 * 86400000);
    expect((await runtime.transport?.call('GET_AUTHORIZATION', h.input))?.status).toBe(200);
  } finally {
    await h.close();
  }
});
it('does not silently enable providers or fall back for unsupported selections', async () => {
  expect((await providerRuntime({})).health()).toEqual([]);
  for (const env of [
    { PROVIDER_PAYPAL: 'fake' },
    { PROVIDER_PAYPAL: 'bad' },
    { PROVIDER_RUNNER: 'sim' },
    { PROVIDER_PAYPAL: 'live' },
    { APP_ENV: 'production', PROVIDER_PAYPAL: 'sim' },
  ])
    await expect(providerRuntime(env)).rejects.toThrow();
});
