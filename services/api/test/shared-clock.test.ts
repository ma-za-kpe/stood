import { describe, expect, it, vi } from 'vitest';
import { ControlledClockClient } from '../src/adapters/controlled-clock/client.js';
import { createApp } from '../src/http/app.js';
import { simulatorHarness } from './contracts/paypal-simulator.js';

it('uses the provider clock for Stood requests and fails closed when it cannot be read', async () => {
  const h = await simulatorHarness();
  try {
    const clock = new ControlledClockClient('ci', h.baseUrl);
    const app = createApp({
      appEnv: 'ci',
      paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
      demoMode: true,
      requestClock: () => clock.read(),
      clockMode: 'controlled',
    });
    const first = await (await app.request('/health')).json();
    h.advance(29);
    const last = await (await app.request('/health')).json();
    expect(last.clock.now - first.clock.now).toBe(29 * 86400000);
    expect(last.clock.mode).toBe('controlled');
    expect((await h.transport.call('GET_AUTHORIZATION', h.input)).body).toMatchObject({ status: 'EXPIRED' });
    await h.close();
    expect((await app.request('/health')).status).toBe(503);
  } catch (error) {
    await h.close();
    throw error;
  }
});
describe('Clock destination guard', () => {
  it('sanitises malformed destinations and clock replies instead of echoing their contents', async () => {
    try {
      new ControlledClockClient('ci', 'fixture-secret');
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ message: 'Controlled clock is not configured' });
      expect(error).not.toHaveProperty('input');
    }
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('fixture-secret', { headers: { 'X-Stood-Simulated': 'true' } }));
    try {
      await expect(new ControlledClockClient('ci', 'http://127.0.0.1').read()).rejects.toMatchObject({
        message: 'Controlled clock unavailable',
      });
    } finally {
      fetch.mockRestore();
    }
  });
  it.each([
    'https://api-m.sandbox.paypal.com',
    'http://example.com',
    'http://127.0.0.1/path',
    'http://user:pass@127.0.0.1',
  ])('rejects %s', (url) => {
    expect(() => new ControlledClockClient('ci', url)).toThrow();
  });
  it('rejects a controlled clock in production', () => {
    expect(() => new ControlledClockClient('production', 'http://127.0.0.1')).toThrow();
  });
});
