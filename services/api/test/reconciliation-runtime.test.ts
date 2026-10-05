import { expect, it } from 'vitest';
import { reconciliationRuntime } from '../src/reconciliation-runtime.js';
import { simulatorHarness } from './contracts/paypal-simulator.js';

it('uses explicit simulator selection and shares its controlled time without real keys', async () => {
  const h = await simulatorHarness();
  try {
    const runtime = await reconciliationRuntime({ APP_ENV: 'ci', PROVIDER_PAYPAL: 'sim', PAYPAL_SIM_URL: h.baseUrl });
    const first = await runtime.clock();
    h.advance(4);
    expect(await runtime.clock()).toBe(first + 4 * 86400000);
    expect(runtime.health()).toEqual([{ provider: 'paypal', mode: 'sim', simulated: true, ready: true }]);
    expect((await runtime.transport.call('GET_AUTHORIZATION', h.input)).status).toBe(200);
  } finally {
    await h.close();
  }
});
it('refuses reconciliation without an explicit configured provider', async () => {
  await expect(reconciliationRuntime({ APP_ENV: 'ci' })).rejects.toThrow('Reconciliation provider is not configured');
});
