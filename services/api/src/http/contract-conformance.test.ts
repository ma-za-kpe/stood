import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openApiDocument } from './contract.js';

// T-0156: typed errors on every route. Every route in the published contract is driven into the failures it can
// really meet: no signature, a body over 64 KiB, an invalid body, and storage that is down. Each answer must be a
// status the contract documents for that route, as an RFC 9457 problem with a stable code.
const now = 1790985600000;
const [key, secret] = ['conformance_key', 'conformance_secret'];
// Every store method fails the way a lost database does.
const down = new Proxy(
  {},
  {
    get: (_target, prop) =>
      prop === 'then'
        ? undefined
        : async () => {
            throw new Error('database unavailable');
          },
  },
);
const app = createApp({
  appEnv: 'ci',
  paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
  demoMode: false,
  api: {
    store: down as never,
    versions: down as never,
    packages: down as never,
    baselines: down as never,
    usage: { store: down as never, authorities: [] },
    signing: { mode: 'sim', mandates: down as never, funding: down as never },
    platformId: 'platform_c',
    key,
    secret,
    clock: () => now,
  },
});
const sign = (method: string, path: string, body: string, idem = 'idem-1') => {
  const t = String(Math.floor(now / 1000));
  return {
    Authorization: `Bearer ${key}`,
    'Stood-Signature': `t=${t},v2=${createHmac('sha256', secret)
      .update(JSON.stringify(['stood.request@2', t, method, path, idem, '', 'application/json', body]))
      .digest('hex')}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': idem,
  };
};
const routes = Object.entries(openApiDocument().paths).flatMap(([template, ops]) =>
  Object.entries(ops as Record<string, { responses: Record<string, unknown>; requestBody?: unknown }>).map(
    ([method, op]) => ({
      method: method.toUpperCase(),
      template,
      path: `/v1${template.replace(/\{[^}]+\}/g, (p) => `${p.slice(1, -1)}_1`)}`,
      documented: Object.keys(op.responses).map(Number),
      hasBody: Boolean(op.requestBody),
    }),
  ),
);

describe('every route answers only what its contract documents', () => {
  it('covers every route in the contract', () => {
    expect(routes.length).toBeGreaterThanOrEqual(12);
  });
  for (const r of routes)
    it(`${r.method} ${r.template}`, async () => {
      const cases: { why: string; init: RequestInit }[] = [
        { why: 'no signature', init: { method: r.method, ...(r.hasBody ? { body: '{}' } : {}) } },
        {
          why: 'storage down',
          init: {
            method: r.method,
            headers: sign(r.method, r.path, r.hasBody ? '{}' : ''),
            ...(r.hasBody ? { body: '{}' } : {}),
          },
        },
      ];
      if (r.hasBody) {
        const big = JSON.stringify({ pad: 'x'.repeat(70_000) });
        cases.push({ why: 'over 64 KiB', init: { method: r.method, headers: sign(r.method, r.path, big), body: big } });
        cases.push({
          why: 'not JSON',
          init: { method: r.method, headers: sign(r.method, r.path, 'not json'), body: 'not json' },
        });
      }
      for (const c of cases) {
        const response = await app.request(r.path, c.init);
        expect(r.documented, `${c.why}: ${response.status} undocumented`).toContain(response.status);
        if (response.status >= 400) {
          expect(response.headers.get('Content-Type'), c.why).toContain('application/problem+json');
          expect((await response.json()) as { code?: unknown }, c.why).toMatchObject({ code: expect.any(String) });
        }
      }
    });
});
