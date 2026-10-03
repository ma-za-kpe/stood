import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('API bootstrap and fixture preview', () => {
  it('reports liveness without claiming payment readiness', async () => {
    const response = await createApp({
      appEnv: 'local',
      paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
      demoMode: false,
    }).request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', paymentReady: false });
  });
  it('refuses live or unexpected environments and payment hosts', () => {
    expect(() =>
      createApp({ appEnv: 'live', paypalBaseUrl: 'https://api-m.sandbox.paypal.com', demoMode: false }),
    ).toThrow();
    expect(() => createApp({ appEnv: 'local', paypalBaseUrl: 'https://api-m.paypal.com', demoMode: false })).toThrow();
    expect(() =>
      createApp({ appEnv: 'demo', paypalBaseUrl: 'https://api-m.sandbox.paypal.com.evil.test', demoMode: true }),
    ).toThrow();
  });
  it('does not expose fixtures unless explicitly enabled', async () => {
    const app = createApp({ appEnv: 'local', paypalBaseUrl: 'https://api-m.sandbox.paypal.com', demoMode: false });
    expect((await app.request('/v1/demo/scenarios/good', { method: 'POST' })).status).toBe(404);
  });
  it.each([
    ['good', 'RELEASE'],
    ['wrong-plot', 'REFUSE'],
    ['recycled', 'REFUSE'],
    ['wrong-stage', 'WAIT'],
    ['nonce-unreadable', 'WAIT'],
    ['mock-location', 'WAIT'],
    ['freelance-missing-screen', 'REFUSE'],
  ])('runs %s through the real pure rule as %s, without a payment', async (name, outcome) => {
    const app = createApp({ appEnv: 'local', paypalBaseUrl: 'https://api-m.sandbox.paypal.com', demoMode: true });
    const response = await app.request(`/v1/demo/scenarios/${name}`, { method: 'POST' });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      outcome,
      payment: { executed: false },
      evidenceTier: 'fixture',
      source: 'synthetic_check_results',
    });
    expect(payload.paypal).toBeUndefined();
    expect(payload.sentence).toContain('No payment was executed.');
    if (name === 'wrong-plot') {
      expect(payload.sentence).toBe('Wrong plot. 1.4 km off. No payment was executed.');
      expect(payload.detail).toEqual({ distance_m: 1400 });
    }
    if (name === 'recycled') expect(payload.detail).toEqual({ matched_package_id: 'fixture_pkg_prior' });
  });
  it('returns problem+json for unknown scenarios', async () => {
    const app = createApp({ appEnv: 'local', paypalBaseUrl: 'https://api-m.sandbox.paypal.com', demoMode: true });
    const response = await app.request('/v1/demo/scenarios/unknown', { method: 'POST' });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });
});
