import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { draft, harness, key, now, pkg, secret } from '../fixtures/contract-app.js';

// T-0053: the TypeScript SDK that APIMatic generates from openapi/stood.json, with Stood's saved request-signing
// customization, against the real router over HTTP. Built by scripts/check-sdk before this runs.
type Sdk = {
  createStoodClient(options: object): unknown;
  Api: new (
    client: unknown,
  ) => Record<string, (...args: unknown[]) => Promise<{ statusCode: number; result: Record<string, unknown> }>>;
  ProblemError: new (...args: never[]) => Error;
};
let server: ReturnType<typeof serve>;
let base = '';
let sdk: Sdk;
beforeAll(async () => {
  const app = await harness();
  server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  sdk = (await import(new URL('../../../../sdk/typescript/dist/esm/index.js', import.meta.url).href)) as Sdk;
});
afterAll(() => server?.close());
const api = (signingSecret = secret) =>
  new sdk.Api(sdk.createStoodClient({ platformKey: key, signingSecret, baseUrl: base, clock: () => now }));

describe('APIMatic-generated Stood SDK', () => {
  it('signs every call and reads every documented response', async () => {
    const stood = api();
    const created = await stood.createAllowance('sdk-1', {
      payeeRef: draft.payee_ref,
      cap: draft.cap,
      milestones: draft.milestones,
      windowDays: draft.window_days,
      maxResubmits: draft.max_resubmits,
    });
    expect(created.statusCode).toBe(201);
    expect(created.result).toMatchObject({ id: 'alw_1', status: 'DRAFT' });
    expect((await stood.getAllowance('alw_1')).result).toMatchObject({ payeeRef: 'builder_1' });
    expect((await stood.getTranche('trn_1')).result).toMatchObject({ state: 'VOID_PENDING', packageId: 'pkg_1' });
    expect((await stood.requestMandate('alw_1', 'm-key', {})).statusCode).toBe(202);
    expect((await stood.getMandate('alw_1', 'm-key')).result).toMatchObject({ status: 'AWAITING_APPROVAL' });
    expect((await stood.requestFunding('trn_1', 'f-key', { expectedVersion: 0, nonce: 'K7Q' })).statusCode).toBe(202);
    expect((await stood.getFunding('trn_1', 'f-key')).result).toMatchObject({ status: 'HELD' });
    const submitted = await stood.submitPackage('trn_1', 'p-key', {
      repository: pkg.repository,
      baseCommit: pkg.base_commit,
      commitSha: pkg.commit_sha,
      reportRef: pkg.report_ref,
      reportSha256: pkg.report_sha256,
    });
    expect(submitted.result).toMatchObject({ status: 'QUEUED', waitingFor: 'RUNNER' });
    expect((await stood.getPackage('trn_1', 'pkg_1')).result).toMatchObject({ id: 'pkg_1' });
  });

  it('surfaces problems as typed errors, and a wrong secret is refused', async () => {
    await expect(api().getTranche('missing')).rejects.toBeInstanceOf(sdk.ProblemError);
    await expect(api('not-the-secret').getTranche('trn_1')).rejects.toMatchObject({ statusCode: 401 });
  });
});
