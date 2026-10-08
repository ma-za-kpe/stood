import { expect, it } from 'vitest';
import { TribunalCatalog } from './tribunal-catalog.js';

const payload = {
  items: [
    {
      title: 'Idea',
      slug: 'idea',
      problem_statement: 'Problem',
      target_customer: 'Buyer',
      catalog_decision: 'rejected',
      catalog_caveat: 'Needs research',
      catalog_reason_codes: ['tribunal_rejected'],
      url: 'https://startuptribunal.com/catalog/idea',
      blueprint_url: 'https://startuptribunal.com/catalog/idea/ideas/one',
    },
  ],
  attribution: { text: 'Research by StartupTribunal', url: 'https://startuptribunal.com/catalog', required: true },
};
it('fetches only the fixed public feed, validates attribution and caveats, and reuses its ten-minute cache', async () => {
  let calls = 0,
    now = 1000;
  const catalog = new TribunalCatalog(
    async (url) => {
      calls++;
      expect(String(url)).toBe('https://startuptribunal.com/api/public/ideas?limit=10');
      return Response.json(payload);
    },
    () => now,
  );
  expect(await catalog.list()).toMatchObject(payload);
  await catalog.list();
  expect(calls).toBe(1);
  now += 600_000;
  await catalog.list();
  expect(calls).toBe(2);
});
it('refuses unsafe links, missing caveats, non-public decisions and oversized feeds without exposing responses', async () => {
  for (const change of [{ url: 'https://evil.example' }, { catalog_decision: 'approved' }, { catalog_caveat: '' }]) {
    const catalog = new TribunalCatalog(async () =>
      Response.json({ ...payload, items: [{ ...payload.items[0], ...change }] }),
    );
    await expect(catalog.list()).rejects.toThrow('RESEARCH_UNAVAILABLE');
  }
  await expect(new TribunalCatalog(async () => new Response('x'.repeat(65537))).list()).rejects.toThrow(
    'RESEARCH_UNAVAILABLE',
  );
});
it('respects upstream rate limits and joins simultaneous reads', async () => {
  let calls = 0,
    now = 1000;
  const catalog = new TribunalCatalog(
    async () => {
      calls++;
      return new Response('', { status: 429, headers: { 'Retry-After': '3600' } });
    },
    () => now,
  );
  await Promise.allSettled([catalog.list(), catalog.list()]);
  expect(calls).toBe(1);
  await expect(catalog.list()).rejects.toThrow('RESEARCH_UNAVAILABLE');
  expect(calls).toBe(1);
  now += 3600000;
  await expect(catalog.list()).rejects.toThrow('RESEARCH_UNAVAILABLE');
  expect(calls).toBe(2);
});

it('backs off failed refreshes so unavailable research cannot exhaust the public feed quota', async () => {
  let calls = 0,
    now = 1000;
  const catalog = new TribunalCatalog(
    async () => {
      calls++;
      return new Response('', { status: 503 });
    },
    () => now,
  );
  await expect(catalog.list()).rejects.toThrow('RESEARCH_UNAVAILABLE');
  await expect(catalog.list()).rejects.toThrow('RESEARCH_UNAVAILABLE');
  expect(calls).toBe(1);
  now += 120_000;
  await expect(catalog.list()).rejects.toThrow('RESEARCH_UNAVAILABLE');
  expect(calls).toBe(2);
});

it('retains explicit null caveats from the live rejected-only feed without inventing an endorsement', async () => {
  const catalog = new TribunalCatalog(async () =>
    Response.json({
      ...payload,
      items: [{ ...payload.items[0], catalog_caveat: null, catalog_reason_codes: [], target_customer: null }],
    }),
  );
  const value = await catalog.list();
  expect(value.items[0]?.catalog_decision).toBe('rejected');
  expect(value.items[0]?.catalog_caveat).toBeNull();
  expect(value.items[0]?.target_customer).toBeNull();
});
