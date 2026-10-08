import { describe, expect, it } from 'vitest';
import { createYardApp } from './app.js';

describe('Yard shell, no payment capabilities (T-0175)', () => {
  it('reports only its own readiness and cannot claim money or live services', async () => {
    const app = createYardApp({ environment: 'ci' });
    const response = await app.request('/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      product: 'yard',
      environment: 'ci',
      capabilities: {
        board: false,
        foreman: false,
        intake: false,
        credentials: false,
        siteLog: false,
        events: false,
        payments: false,
      },
    });
  });
  it('fails closed for every unimplemented command with no body reflection', async () => {
    const app = createYardApp({ environment: 'local' });
    for (const path of [
      '/yard/v1/blueprints',
      '/yard/v1/intakes',
      '/yard/v1/work-orders/wo/claim',
      '/yard/v1/webhooks/stood',
    ]) {
      const response = await app.request(path, { method: 'POST', body: 'private input' });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain('private');
    }
    expect((await app.request('/yard/v1/board')).status).toBe(503);
    expect((await app.request('/v1/allowances', { method: 'POST' })).status).toBe(404);
  });
  it('refuses unspecified production configurations', () => {
    expect(() => createYardApp({ environment: 'production' })).toThrow();
  });
});

// T-0262: the public site reads Yard's health to show the live status; nothing else crosses origins.
it('lets only the project site read Yard health across origins', async () => {
  const app = createYardApp({ environment: 'ci' });
  const site = await app.request('/health', { headers: { Origin: 'https://ma-za-kpe.github.io' } });
  expect(site.headers.get('access-control-allow-origin')).toBe('https://ma-za-kpe.github.io');
  const other = await app.request('/health', { headers: { Origin: 'https://evil.example' } });
  expect(other.headers.get('access-control-allow-origin')).toBeNull();
  const board = await app.request('/yard/v1/board', { headers: { Origin: 'https://ma-za-kpe.github.io' } });
  expect(board.headers.get('access-control-allow-origin')).toBeNull();
});
