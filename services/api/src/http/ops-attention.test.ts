import { expect, it } from 'vitest';
import { createApp } from './app.js';

const base = { appEnv: 'local', paypalBaseUrl: 'https://api-m.sandbox.paypal.com', demoMode: false } as const;

it('says whether a person is needed, with counts only, and is honest when it cannot tell (T-0155)', async () => {
  const quiet = createApp({
    ...base,
    attention: { read: async () => ({ openFindings: 0, openAlerts: 0, oldestOpenedAt: null }) },
  });
  expect(await (await quiet.request('/ops/attention')).json()).toEqual({
    needsPerson: false,
    openFindings: 0,
    openAlerts: 0,
    oldestOpenedAt: null,
  });
  const busy = createApp({
    ...base,
    attention: { read: async () => ({ openFindings: 2, openAlerts: 1, oldestOpenedAt: '2026-10-08T11:39:23Z' }) },
  });
  const response = await busy.request('/ops/attention');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({
    needsPerson: true,
    openFindings: 2,
    openAlerts: 1,
    oldestOpenedAt: '2026-10-08T11:39:23Z',
  });
  const off = await createApp(base).request('/ops/attention');
  expect(off.status).toBe(503);
  expect(await off.json()).toEqual({ code: 'attention_not_configured' });
  const broken = createApp({
    ...base,
    attention: {
      read: async () => {
        throw new Error('database down: postgres://secret');
      },
    },
  });
  const failed = await broken.request('/ops/attention');
  expect(failed.status).toBe(503);
  expect(await failed.text()).not.toContain('secret');
});

// T-0262: the public site (GitHub Pages) reads health and attention to show the live status; nothing else may.
it('lets only the project site read health and attention across origins, for GET only', async () => {
  const app = createApp({
    ...base,
    attention: { read: async () => ({ openFindings: 0, openAlerts: 0, oldestOpenedAt: null }) },
  });
  for (const path of ['/health', '/ops/attention']) {
    const site = await app.request(path, { headers: { Origin: 'https://ma-za-kpe.github.io' } });
    expect(site.headers.get('access-control-allow-origin')).toBe('https://ma-za-kpe.github.io');
    expect(site.headers.get('access-control-allow-credentials')).toBeNull();
    const other = await app.request(path, { headers: { Origin: 'https://evil.example' } });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  }
  const write = await app.request('/v1/allowances', { headers: { Origin: 'https://ma-za-kpe.github.io' } });
  expect(write.headers.get('access-control-allow-origin')).toBeNull();
});
