export const PROVIDERS = [
  'paypal',
  'runner',
  'github',
  'render',
  'secret_store',
  'email',
  'storage',
  'planner',
  'search',
  'browser_qa',
  'notifications',
  'stood',
  'crew',
] as const;
export type ProviderMode = 'fake' | 'sim' | 'live';
export type ProviderHealth = Readonly<{ provider: string; mode: ProviderMode; simulated: boolean; ready: true }>;
type Connection = Readonly<{ adapter: unknown; ready: () => Promise<boolean> }>;
type Factory = (keys: Readonly<Record<string, string | undefined>>, signal: AbortSignal) => Promise<Connection>;
export type ProviderDefinition = {
  id: (typeof PROVIDERS)[number];
  requiredKeys: readonly string[];
  factories: Partial<Record<string, Factory>>;
};
export class ProviderConfigurationError extends Error {
  constructor(
    public readonly code: 'INVALID_CONFIGURATION' | 'MISSING_KEYS' | 'NOT_READY' | 'UNKNOWN_PROVIDER',
    public readonly provider: string,
    public readonly missing: readonly string[] = [],
  ) {
    super(code === 'NOT_READY' ? `Provider ${provider} is not ready.` : `Provider ${provider}: ${code}.`);
    this.name = 'ProviderConfigurationError';
  }
}
export async function bootProviders(
  config: Readonly<{
    environment: string;
    selections: Readonly<Record<string, string | undefined>>;
    keys: Readonly<Record<string, string | undefined>>;
    definitions: readonly ProviderDefinition[];
    timeoutMs?: number;
  }>,
) {
  const timeoutMs = config.timeoutMs ?? 5000;
  if (
    !['local', 'ci', 'demo', 'production'].includes(config.environment) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  )
    throw new ProviderConfigurationError('INVALID_CONFIGURATION', 'registry');
  const keys = Object.freeze({ ...config.keys });
  const ids = new Set(config.definitions.map((d) => d.id));
  if (
    ids.size !== config.definitions.length ||
    Object.keys(config.selections).some((id) => !ids.has(id as ProviderDefinition['id']))
  )
    throw new ProviderConfigurationError('INVALID_CONFIGURATION', 'registry');
  // Validate the entire plan before constructing any connection.
  const plan = config.definitions.map((d) => {
    const mode = config.selections[d.id];
    if (
      !PROVIDERS.includes(d.id) ||
      !['fake', 'sim', 'live'].includes(mode ?? '') ||
      (config.environment === 'production' && mode !== 'live') ||
      d.requiredKeys.some((name) => !/^[A-Z][A-Z0-9_]*$/.test(name))
    )
      throw new ProviderConfigurationError('INVALID_CONFIGURATION', PROVIDERS.includes(d.id) ? d.id : 'registry');
    const factory = d.factories[mode as ProviderMode];
    if (!factory) throw new ProviderConfigurationError('INVALID_CONFIGURATION', d.id);
    const missing = mode === 'live' ? d.requiredKeys.filter((name) => !keys[name]?.trim()) : [];
    if (missing.length) throw new ProviderConfigurationError('MISSING_KEYS', d.id, Object.freeze(missing));
    return { id: d.id, mode: mode as ProviderMode, factory };
  });
  const adapters = new Map<string, unknown>();
  const health: ProviderHealth[] = [];
  for (const item of plan) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const connection = await Promise.race([
        (async () => {
          const connection = await item.factory(item.mode === 'live' ? keys : Object.freeze({}), controller.signal);
          if ((await connection.ready()) !== true) throw new Error('Not ready');
          return connection;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Timeout'));
          }, timeoutMs);
        }),
      ]);
      adapters.set(item.id, connection.adapter);
      health.push(Object.freeze({ provider: item.id, mode: item.mode, simulated: item.mode !== 'live', ready: true }));
    } catch {
      controller.abort();
      throw new ProviderConfigurationError('NOT_READY', item.id);
    } finally {
      clearTimeout(timer);
    }
  }
  const snapshot = Object.freeze(health);
  return Object.freeze({
    get(id: string): unknown {
      if (!adapters.has(id)) throw new ProviderConfigurationError('UNKNOWN_PROVIDER', 'registry');
      return adapters.get(id);
    },
    health(): readonly ProviderHealth[] {
      return snapshot;
    },
  });
}
