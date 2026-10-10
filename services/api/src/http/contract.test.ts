import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';
import { draft, harness, now, pkg, signed } from '../../test/fixtures/contract-app.js';
import {
  Allowance,
  AllowanceDraft,
  CommitPackage,
  CommitPackageInput,
  Funding,
  FundingRequest,
  Mandate,
  openApiDocument,
  operations,
  Problem,
  Tranche,
} from './contract.js';
import { platformApi } from './platform-api.js';

async function check(response: Response, status: number, schema: z.ZodType) {
  expect(response.status).toBe(status);
  return schema.parse(await response.json());
}

// T-0053: the OpenAPI document is generated from the Zod contract, and the real router is held to it.
describe('Stood API contract', () => {
  it('commits exactly the document the contract generates', () => {
    const committed = readFileSync(new URL('../../../../openapi/stood.json', import.meta.url), 'utf8');
    expect(committed).toBe(`${JSON.stringify(openApiDocument(), null, 2)}\n`);
  });

  it('describes every route the router serves, and no route it does not', () => {
    const app = platformApi({
      store: { create: vi.fn(), allowance: vi.fn(), tranche: vi.fn() },
      platformId: 'p',
      key: 'k',
      secret: 's',
      clock: () => now,
    });
    const served = new Set(
      app.routes
        .filter((r) => r.method !== 'ALL')
        .map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, '{$1}')}`),
    );
    expect(new Set(operations.map((op) => `${op.method} ${op.path}`))).toEqual(served);
    const doc = openApiDocument();
    for (const op of operations) expect(doc.paths[op.path]?.[op.method]).toMatchObject({ operationId: op.id });
    expect(doc.openapi).toBe('3.1.0');
  });

  it('every response the router gives matches its documented schema', async () => {
    const app = await harness();
    const body = JSON.stringify(draft);
    await check(await app.request('/v1/allowances', signed('POST', '/allowances', body, 'k1')), 201, Allowance);
    await check(await app.request('/v1/allowances/alw_1', signed('GET', '/allowances/alw_1')), 200, Allowance);
    await check(
      await app.request('/v1/allowances/alw_1/mandate', signed('POST', '/allowances/alw_1/mandate', '{}', 'm-key')),
      202,
      Mandate,
    );
    await check(
      await app.request('/v1/allowances/alw_1/mandate/m-key', signed('GET', '/allowances/alw_1/mandate/m-key')),
      200,
      Mandate,
    );
    const tranche = (await check(
      await app.request('/v1/tranches/trn_1', signed('GET', '/tranches/trn_1')),
      200,
      Tranche,
    )) as z.infer<typeof Tranche>;
    expect(tranche).toMatchObject({ state: 'VOID_PENDING', decision: { outcome: 'REFUSE' }, package_id: 'pkg_1' });
    expect(tranche.hold).not.toBeNull();
    const funding = JSON.stringify({ expected_version: 0, nonce: 'K7Q' });
    await check(
      await app.request('/v1/tranches/trn_1/funding', signed('POST', '/tranches/trn_1/funding', funding, 'f-key')),
      202,
      Funding,
    );
    await check(
      await app.request('/v1/tranches/trn_1/funding/f-key', signed('GET', '/tranches/trn_1/funding/f-key')),
      200,
      Funding,
    );
    await check(
      await app.request(
        '/v1/tranches/trn_1/packages',
        signed('POST', '/tranches/trn_1/packages', JSON.stringify(pkg), 'p-key'),
      ),
      202,
      CommitPackage,
    );
    await check(
      await app.request('/v1/tranches/trn_1/packages/pkg_1', signed('GET', '/tranches/trn_1/packages/pkg_1')),
      200,
      CommitPackage,
    );
    for (const [path, status] of [
      ['/allowances/missing', 404],
      ['/tranches/missing', 404],
    ] as const)
      await check(await app.request(`/v1${path}`, signed('GET', path)), status, Problem);
    await check(await app.request('/v1/tranches/trn_1', { headers: {} }), 401, Problem);
  });

  it('accepts and refuses the same request bodies the router does', async () => {
    const app = await harness();
    expect(AllowanceDraft.safeParse(draft).success).toBe(true);
    expect(FundingRequest.safeParse({ expected_version: 0, nonce: 'K7Q' }).success).toBe(true);
    expect(CommitPackageInput.safeParse(pkg).success).toBe(true);
    const refused: [string, string, unknown, z.ZodType][] = [
      ['/allowances', 'a', { ...draft, extra: 1 }, AllowanceDraft],
      ['/allowances', 'b', { ...draft, cap: { minor: 1.5, currency: 'USD' } }, AllowanceDraft],
      ['/tranches/trn_1/funding', 'c', { expected_version: -1, nonce: 'K7Q' }, FundingRequest],
      ['/tranches/trn_1/funding', 'd', { expected_version: 0, nonce: 'K71' }, FundingRequest],
      ['/tranches/trn_1/packages', 'e', { ...pkg, commit_sha: 'main' }, CommitPackageInput],
      ['/tranches/trn_1/packages', 'f', { ...pkg, extra: 'x' }, CommitPackageInput],
    ];
    for (const [path, idem, value, schema] of refused) {
      expect(schema.safeParse(value).success, `${path} ${idem}`).toBe(false);
      const response = await app.request(`/v1${path}`, signed('POST', path, JSON.stringify(value), idem));
      expect(response.status, `${path} ${idem}`).toBe(422);
      Problem.parse(await response.json());
    }
  });
});
