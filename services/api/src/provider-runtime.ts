import { ControlledClockClient } from './adapters/controlled-clock/client.js';
import { type PayPalTransport, ServerSdkTransport } from './adapters/payments-paypal/sdk.js';
import { bootProviders, ProviderConfigurationError, type ProviderHealth } from './application/provider-registry.js';

export async function providerRuntime(env: Readonly<Record<string, string | undefined>>) {
  const environment = env.APP_ENV ?? 'local';
  const mode = env.PROVIDER_PAYPAL;
  if (Object.entries(env).some(([key, value]) => key.startsWith('PROVIDER_') && key !== 'PROVIDER_PAYPAL' && value))
    throw new ProviderConfigurationError('INVALID_CONFIGURATION', 'registry');
  if (!mode)
    return { health: (): readonly ProviderHealth[] => [], clock: async () => Date.now(), clockMode: 'system' as const };
  const baseUrl =
    mode === 'sim'
      ? (env.PAYPAL_SIM_URL ?? 'http://paypal-sim:8080')
      : (env.PAYPAL_BASE_URL ?? 'https://api-m.sandbox.paypal.com');
  const controlled = mode === 'sim' ? new ControlledClockClient(environment, baseUrl) : null;
  const factory = async (keys: Readonly<Record<string, string | undefined>>) => {
    const transport = new ServerSdkTransport({
      appEnv: environment,
      mode,
      baseUrl,
      clientId: mode === 'sim' ? 'sim-client' : (keys.PAYPAL_CLIENT_ID ?? ''),
      clientSecret: mode === 'sim' ? 'sim-secret' : (keys.PAYPAL_CLIENT_SECRET ?? ''),
      // T-0260: where PayPal sends the buyer after saving their account (one https origin in the sandbox).
      vaultReturnUrl:
        mode === 'sim'
          ? 'http://api:3000/paypal/return'
          : (keys.PAYPAL_VAULT_RETURN_URL ?? 'https://ma-za-kpe.github.io/stood/?vault=saved'),
      vaultCancelUrl:
        mode === 'sim'
          ? 'http://api:3000/paypal/cancel'
          : (keys.PAYPAL_VAULT_CANCEL_URL ?? 'https://ma-za-kpe.github.io/stood/?vault=cancelled'),
    });
    return {
      adapter: transport,
      ready: async () => {
        if (controlled) await controlled.read();
        const result = await transport.call('GET_AUTHORIZATION', {
          authorizationId: 'STOOD-READINESS-NO-PAYMENT',
          requestId: 'readiness',
          operationKey: 'readiness',
          amount: { currencyCode: 'USD', value: '1.00' },
        });
        return result.status === 404;
      },
    };
  };
  const registry = await bootProviders<{ paypal: PayPalTransport }>({
    environment,
    keys: env,
    selections: { paypal: mode },
    definitions: [
      {
        id: 'paypal',
        requiredKeys: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
        factories: { sim: factory, live: factory },
      },
    ],
  });
  return {
    health: registry.health,
    clock: controlled ? () => controlled.read() : async () => Date.now(),
    clockMode: controlled ? ('controlled' as const) : ('system' as const),
    transport: registry.get('paypal'),
  };
}
