import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { bootProviders, ProviderConfigurationError, type ProviderDefinition } from './provider-registry.js';

const definition = (): ProviderDefinition => ({
  id: 'paypal',
  requiredKeys: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET'],
  factories: Object.fromEntries(
    ['fake', 'sim', 'live'].map((mode) => [
      mode,
      vi.fn(async () => ({
        adapter: { mode },
        ready: async () => true,
      })),
    ]),
  ),
});
describe('Explicit provider boot registry', () => {
  it('returns the declared port type and preserves a safe startup failure reason', async () => {
    type Ports = { paypal: { ping(): Promise<string> } };
    const registry = await bootProviders<Ports>({
      environment: 'ci',
      selections: { paypal: 'sim' },
      keys: {},
      definitions: [
        {
          id: 'paypal',
          requiredKeys: [],
          factories: {
            sim: async () => ({
              adapter: { ping: async () => 'pong' },
              ready: async () => true,
            }),
          },
        },
      ],
    });
    expectTypeOf(registry.get('paypal')).toEqualTypeOf<Ports['paypal']>();
    expect(await registry.get('paypal').ping()).toBe('pong');
    const d = definition();
    d.factories.sim = async () => ({ adapter: {}, ready: async () => false });
    await expect(
      bootProviders({ environment: 'ci', selections: { paypal: 'sim' }, keys: {}, definitions: [d] }),
    ).rejects.toMatchObject({ reason: 'READINESS_REJECTED' });
  });
  it.each(['fake', 'sim', 'live'])('selects only %s and freezes sanitised health', async (mode) => {
    const d = definition();
    const registry = await bootProviders({
      environment: 'ci',
      selections: { paypal: mode },
      keys: {
        PAYPAL_CLIENT_ID: 'fixture-id',
        PAYPAL_CLIENT_SECRET: 'fixture-secret',
      },
      definitions: [d],
    });
    expect(registry.get('paypal')).toEqual({ mode });
    expect(registry.health()).toEqual([{ provider: 'paypal', mode, simulated: mode !== 'live', ready: true }]);
    expect(JSON.stringify(registry.health())).not.toContain('fixture-secret');
    expect(Object.isFrozen(registry.health())).toBe(true);
    for (const other of ['fake', 'sim', 'live'])
      expect(d.factories[other]).toHaveBeenCalledTimes(other === mode ? 1 : 0);
    expect(() => registry.get('github')).toThrow(ProviderConfigurationError);
  });
  it('fails before constructing anything on invalid modes, keys or production mocks', async () => {
    for (const config of [
      { environment: 'bad', selections: { paypal: 'fake' }, keys: {} },
      { environment: 'ci', selections: {}, keys: {} },
      { environment: 'ci', selections: { paypal: 'unknown' }, keys: {} },
      { environment: 'ci', selections: { paypal: 'fake', github: 'live' }, keys: {} },
      { environment: 'ci', selections: { paypal: 'live' }, keys: { PAYPAL_CLIENT_ID: ' ' } },
      { environment: 'production', selections: { paypal: 'fake' }, keys: {} },
      { environment: 'production', selections: { paypal: 'sim' }, keys: {} },
    ]) {
      const d = definition();
      await expect(bootProviders({ ...config, definitions: [d] })).rejects.toBeInstanceOf(ProviderConfigurationError);
      for (const f of Object.values(d.factories)) expect(f).not.toHaveBeenCalled();
    }
  });
  it('names missing keys and never leaks thrown credentials or falls back', async () => {
    const d = definition();
    await expect(
      bootProviders({ environment: 'ci', selections: { paypal: 'live' }, keys: {}, definitions: [d] }),
    ).rejects.toMatchObject({ code: 'MISSING_KEYS', provider: 'paypal', missing: d.requiredKeys });
    d.factories.live = async () => {
      throw new Error('fixture-secret');
    };
    await expect(
      bootProviders({
        environment: 'ci',
        selections: { paypal: 'live' },
        keys: {
          PAYPAL_CLIENT_ID: 'id',
          PAYPAL_CLIENT_SECRET: 'fixture-secret',
        },
        definitions: [d],
      }),
    ).rejects.toMatchObject({
      code: 'NOT_READY',
      reason: 'CONSTRUCTION_FAILED',
      message: 'Provider paypal is not ready (CONSTRUCTION_FAILED).',
    });
    expect(d.factories.fake).not.toHaveBeenCalled();
    expect(d.factories.sim).not.toHaveBeenCalled();
  });
  it('requires positive readiness and bounds stalled readiness', async () => {
    const d = definition();
    d.factories.sim = async () => ({ adapter: {}, ready: async () => false });
    await expect(
      bootProviders({ environment: 'ci', selections: { paypal: 'sim' }, keys: {}, definitions: [d] }),
    ).rejects.toMatchObject({ code: 'NOT_READY' });
    vi.useFakeTimers();
    try {
      d.factories.sim = async () => ({ adapter: {}, ready: () => new Promise(() => {}) });
      const pending = bootProviders({
        environment: 'ci',
        selections: { paypal: 'sim' },
        keys: {},
        definitions: [d],
        timeoutMs: 25,
      });
      const assertion = expect(pending).rejects.toMatchObject({ code: 'NOT_READY', reason: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
