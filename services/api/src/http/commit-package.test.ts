import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CommitPackageError } from '../ports/commit-package-store.js';
import { createApp } from './app.js';

const now = 1790985600000;
const input = {
  repository: 'owner/repo',
  base_commit: 'a'.repeat(40),
  commit_sha: 'b'.repeat(40),
  report_ref: 'reports/package.json',
  report_sha256: 'c'.repeat(64),
};
function headers(body = '', path = '/v1/tranches/trn/packages', overrides: Record<string, string> = {}) {
  const t = String(now / 1000);
  const result = {
    Authorization: 'Bearer fixture_key',
    'Content-Type': 'application/json',
    'Idempotency-Key': 'package_key',
    ...overrides,
  };
  return {
    ...result,
    'Stood-Signature': `t=${t},v2=${createHmac('sha256', 'fixture_secret')
      .update(
        JSON.stringify([
          'stood.request@2',
          t,
          body ? 'POST' : 'GET',
          path,
          result['Idempotency-Key'],
          '',
          result['Content-Type'],
          body,
        ]),
      )
      .digest('hex')}`,
  };
}
function fixture() {
  const item = {
    id: 'pkg_fixture',
    trancheId: 'trn',
    status: 'QUEUED' as const,
    waitingFor: 'HOLD' as const,
    metadata: input,
    createdAt: new Date(now).toISOString(),
  };
  const packages = { submit: vi.fn(async () => item), get: vi.fn(async () => item as typeof item | null) };
  const store = { create: vi.fn(), allowance: vi.fn(), tranche: vi.fn() };
  return {
    packages,
    app: createApp({
      appEnv: 'ci',
      paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
      demoMode: false,
      api: {
        store,
        packages,
        platformId: 'platform_a',
        key: 'fixture_key',
        secret: 'fixture_secret',
        clock: () => now,
      },
    }),
  };
}
describe('Signed metadata-only commit package API (T-0172)', () => {
  it('queues authenticated tenant-owned references without any payment or execution claim', async () => {
    const { app, packages } = fixture();
    const body = JSON.stringify(input);
    const response = await app.request('/v1/tranches/trn/packages', { method: 'POST', body, headers: headers(body) });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'QUEUED', waitingFor: 'HOLD', metadata: input });
    expect(packages.submit).toHaveBeenCalledWith(
      'platform_a',
      'trn',
      'package_key',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      input,
    );
  });
  it('rejects unauthenticated requests and forged findings, URLs, traversal and malformed references', async () => {
    const { app, packages } = fixture();
    expect((await app.request('/v1/tranches/trn/packages', { method: 'POST', body: '{}' })).status).toBe(401);
    for (const value of [
      'null',
      '{',
      JSON.stringify({ ...input, checks: [{ status: 'PASS' }] }),
      JSON.stringify({ ...input, report_ref: 'https://attacker/report.json' }),
      JSON.stringify({ ...input, report_ref: '../report.json' }),
      JSON.stringify({ ...input, commit_sha: 'bad' }),
      JSON.stringify({ ...input, report_sha256: 1 }),
    ])
      expect(
        (await app.request('/v1/tranches/trn/packages', { method: 'POST', body: value, headers: headers(value) }))
          .status,
      ).toBe(422);
    expect(packages.submit).not.toHaveBeenCalled();
  });
  it('requires JSON and an idempotency key', async () => {
    const { app, packages } = fixture();
    const body = JSON.stringify(input);
    for (const override of [{ 'Content-Type': 'text/plain' }, { 'Idempotency-Key': '' }])
      expect(
        (
          await app.request('/v1/tranches/trn/packages', {
            method: 'POST',
            body,
            headers: headers(body, '/v1/tranches/trn/packages', override),
          })
        ).status,
      ).toBe(422);
    expect(packages.submit).not.toHaveBeenCalled();
  });
  it('uses typed errors and hides foreign/missing packages on signed reads', async () => {
    const { app, packages } = fixture();
    const body = JSON.stringify(input);
    for (const [code, status] of [
      ['CONFLICT', 409],
      ['NOT_FOUND', 404],
      ['INVALID_PACKAGE', 422],
    ] as const) {
      packages.submit.mockRejectedValueOnce(new CommitPackageError(code));
      expect(
        (await app.request('/v1/tranches/trn/packages', { method: 'POST', body, headers: headers(body) })).status,
      ).toBe(status);
    }
    expect(
      (
        await app.request('/v1/tranches/trn/packages/pkg_fixture', {
          headers: headers('', '/v1/tranches/trn/packages/pkg_fixture'),
        })
      ).status,
    ).toBe(200);
    expect(packages.get).toHaveBeenCalledWith('platform_a', 'trn', 'pkg_fixture');
    packages.get.mockResolvedValueOnce(null);
    expect(
      (
        await app.request('/v1/tranches/foreign/packages/pkg_fixture', {
          headers: headers('', '/v1/tranches/foreign/packages/pkg_fixture'),
        })
      ).status,
    ).toBe(404);
  });
});
