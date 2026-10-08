import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createYardApp } from './app.js';

// T-0267: yard-api serves the built Yard page from its own origin, so the page and its API share cookies and need
// no CORS or second service.
it('serves the Yard page under /app with strict headers, and keeps the API routes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yard-web-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Yard</title>');
  writeFileSync(join(root, 'app.js'), 'console.log(1)');
  const app = createYardApp({ environment: 'ci', web: { root } });
  const home = await app.request('/');
  expect(home.status).toBe(302);
  expect(home.headers.get('location')).toBe('/app/');
  const page = await app.request('/app/');
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('<title>Yard</title>');
  expect(page.headers.get('content-security-policy')).toMatch(/default-src 'self'/);
  expect(page.headers.get('x-frame-options')).toBe('DENY');
  expect((await app.request('/app/app.js')).status).toBe(200);
  expect((await app.request('/app/../package.json')).status).toBe(404);
  expect((await app.request('/health')).status).toBe(200);
});

it('redirects the app directory before relative assets are resolved', async () => {
  const root = mkdtempSync(join(tmpdir(), 'yard-web-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Yard</title>');
  const app = createYardApp({ environment: 'ci', web: { root } });
  const response = await app.request('/app?intake=hello');
  expect(response.status).toBe(308);
  expect(response.headers.get('location')).toBe('/app/?intake=hello');
});

it('serves public research without a session and hides upstream failures', async () => {
  let unavailable = false;
  const app = createYardApp({
    environment: 'ci',
    research: {
      list: async () => {
        if (unavailable) throw new Error('upstream private diagnostics');
        return {
          items: [],
          attribution: {
            required: true,
            text: 'Research by StartupTribunal',
            url: 'https://startuptribunal.com/catalog',
          },
        };
      },
    },
  });
  const response = await app.request('/app/api/research/ideas');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('public, max-age=600');
  unavailable = true;
  const failure = await app.request('/app/api/research/ideas');
  expect(failure.status).toBe(503);
  expect(failure.headers.get('cache-control')).toBe('no-store');
  expect(await failure.json()).toEqual({ code: 'research_unavailable' });
});
