import { expect, it } from 'vitest';
import { simulatorHarness } from '../../../test/contracts/paypal-simulator.js';
import { paypalTransportContract } from '../../../test/contracts/paypal-transport.js';
import { ServerSdkTransport } from './sdk.js';

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
