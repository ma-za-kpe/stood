import { describe, expect, it, vi } from 'vitest';
import { StoodClient, StoodClientError } from '../../../../packages/stood-sdk/src/client.js';
import { codeParams } from '../../test/fixtures/code-terms.js';
import { CommitPackageError } from '../ports/commit-package-store.js';
import { createApp } from './app.js';

const at = 1790985600000;
const draft = {
  payee_ref: 'builder',
  cap: { minor: 120000, currency: 'USD' },
  milestones: [
    { name: 'handover', amount: { minor: 120000, currency: 'USD' }, profile: 'code.final@1', params: codeParams },
  ],
  window_days: 7,
  max_resubmits: 1,
};
const input = {
  repository: 'adaeze/bookings',
  base_commit: 'a'.repeat(40),
  commit_sha: 'b'.repeat(40),
  report_ref: 'reports/package.json',
  report_sha256: 'c'.repeat(64),
};
function contract() {
  const stored = { id: 'alw_1', status: 'DRAFT' as const, ...draft, tranches: [{ id: 'trn_1', name: 'handover' }] };
  const item = {
    id: 'pkg_1',
    trancheId: 'trn_1',
    status: 'QUEUED' as const,
    waitingFor: 'HOLD' as const,
    metadata: input,
    createdAt: new Date(at).toISOString(),
  };
  const store = {
    create: vi.fn(async () => stored),
    allowance: vi.fn(async () => stored as typeof stored | null),
    tranche: vi.fn(async () => null),
  };
  const packages = {
    submit: vi.fn(async () => item),
    get: vi.fn(async () => item as typeof item | null),
    latest: vi.fn(async () => item as typeof item | null),
  };
  const app = createApp({
    appEnv: 'ci',
    paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
    demoMode: false,
    api: { store, packages, platformId: 'platform_a', key: 'fixture_key', secret: 'fixture_secret', clock: () => at },
  });
  const transport = vi.fn(async (r: Request) => app.fetch(r));
  const client = new StoodClient({
    baseUrl: 'https://stood.fixture',
    key: 'fixture_key',
    secret: 'fixture_secret',
    clock: () => at,
    transport,
  });
  return { client, transport, store, packages };
}
describe('Public SDK against the actual local Stood HTTP router (T-0179)', () => {
  it('rejects unbound package receipts and fabricated report metadata', async () => {
    const valid = {
      id: 'pkg_1',
      trancheId: 'trn_1',
      status: 'QUEUED',
      waitingFor: 'HOLD',
      createdAt: new Date(at).toISOString(),
      metadata: input,
    };
    for (const patch of [
      { trancheId: 'foreign' },
      { id: 'pkg_other' },
      { status: 'RELEASED' },
      { waitingFor: 'PAID' },
      { createdAt: 'bad' },
      { metadata: { ...input, checks: [{ status: 'PASS' }] } },
      { metadata: { ...input, report_ref: 'https://attacker' } },
      { metadata: { ...input, base_commit: 'bad' } },
    ]) {
      const client = new StoodClient({
        baseUrl: 'https://stood.fixture',
        key: 'key',
        secret: 'secret',
        clock: () => at,
        transport: async () => Response.json({ ...valid, ...patch }),
      });
      await expect(client.getPackage('trn_1', 'pkg_1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('signs drafts and reads correctly, retaining DRAFT rather than inventing approval', async () => {
    const { client, store } = contract();
    const created = await client.createDraft(draft, 'same_key');
    expect(created).toMatchObject({ id: 'alw_1', status: 'DRAFT', tranches: [{ id: 'trn_1', name: 'handover' }] });
    expect(await client.getDraft('alw_1')).toEqual(created);
    // Code terms are stored as checked, with the mutation floor made explicit (T-0159).
    const stored = {
      ...draft,
      milestones: draft.milestones.map((m) => ({ ...m, params: { ...m.params, minMutation: 0 } })),
    };
    expect(store.create).toHaveBeenCalledWith(
      'platform_a',
      'same_key',
      expect.stringMatching(/^[a-f0-9]{64}$/),
      stored,
    );
  });
  it('submits signed references and retrieves only QUEUED intake receipts', async () => {
    const { client, packages } = contract();
    const result = await client.submitPackage('trn_1', input, 'package_key');
    expect(result.status).toBe('QUEUED');
    expect(await client.getPackage('trn_1', 'pkg_1')).toEqual(result);
    expect(packages.submit).toHaveBeenCalledWith('platform_a', 'trn_1', 'package_key', expect.any(String), input);
  });
  it('maps conflicts/missing records without exposing storage details', async () => {
    const { client, packages, store } = contract();
    packages.submit.mockRejectedValueOnce(new CommitPackageError('CONFLICT'));
    await expect(client.submitPackage('trn_1', input, 'same_key')).rejects.toMatchObject({ code: 'CONFLICT' });
    packages.get.mockResolvedValueOnce(null);
    await expect(client.getPackage('foreign', 'pkg_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    store.allowance.mockResolvedValueOnce(null);
    await expect(client.getDraft('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    packages.submit.mockRejectedValueOnce(new Error('private database connection'));
    await expect(client.submitPackage('trn_1', input, 'key')).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: 'Stood request failed.',
    });
  });
  it('exposes malformed input and wrong authentication as typed errors', async () => {
    const { client, transport } = contract();
    await expect(client.createDraft({ ...draft, cap: { minor: 1.5, currency: 'USD' } }, 'key')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const wrong = new StoodClient({
      baseUrl: 'https://stood.fixture',
      key: 'wrong',
      secret: 'wrong',
      clock: () => at,
      transport,
    });
    await expect(wrong.getDraft('alw_1')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(client.createDraft(draft, '')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(client.getDraft('')).rejects.toBeInstanceOf(StoodClientError);
  });
  it('never retries an unknown network outcome, preserves the supplied key, and aborts on timeout', async () => {
    const transport = vi.fn(async () => {
      throw new Error('private transport failure');
    });
    const client = new StoodClient({
      baseUrl: 'https://stood.fixture',
      key: 'key',
      secret: 'secret',
      clock: () => at,
      transport,
    });
    await expect(client.createDraft(draft, 'durable_key')).rejects.toMatchObject({ code: 'UNKNOWN_OUTCOME' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect((transport.mock.calls as unknown as [Request][])[0]?.[0].headers.get('Idempotency-Key')).toBe('durable_key');
    const timed = new StoodClient({
      baseUrl: 'https://stood.fixture',
      key: 'key',
      secret: 'secret',
      clock: () => at,
      timeoutMs: 5,
      // A slow machine can pass the 5 ms deadline before the fake runs; fetch rejects an already-aborted signal too.
      transport: (request) =>
        new Promise((_resolve, reject) => {
          if (request.signal.aborted) reject(new Error('aborted'));
          request.signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    await expect(timed.getDraft('alw')).rejects.toMatchObject({ code: 'TIMEOUT' });
    // A transport that never settles and ignores the abort still times out: the SDK owns its deadline.
    const stuck = new StoodClient({
      baseUrl: 'https://stood.fixture',
      key: 'key',
      secret: 'secret',
      clock: () => at,
      timeoutMs: 5,
      transport: () => new Promise<Response>(() => {}),
    });
    await expect(stuck.getDraft('alw')).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
  it('rejects malformed or oversized success bodies and redirects rather than trusting them', async () => {
    for (const response of [
      new Response('bad'),
      new Response('{}'),
      new Response('x'.repeat(65537)),
      Response.json({ id: 'alw_1', status: 'SIGNED' }),
      new Response('', { status: 302, headers: { Location: 'https://attacker' } }),
    ]) {
      const client = new StoodClient({
        baseUrl: 'https://stood.fixture',
        key: 'key',
        secret: 'secret',
        clock: () => at,
        transport: async () => response,
      });
      await expect(client.getDraft('alw_1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });
  it('requires a pinned secure root URL, bounded timeouts and a valid server clock', async () => {
    for (const baseUrl of [
      'http://attacker',
      'https://user:password@stood.fixture',
      'https://stood.fixture/v1?secret=x',
    ])
      expect(() => new StoodClient({ baseUrl, key: 'key', secret: 'secret', clock: () => at })).toThrow();
    expect(
      () => new StoodClient({ baseUrl: 'https://stood.fixture', key: '', secret: 'secret', clock: () => at }),
    ).toThrow();
    expect(
      () =>
        new StoodClient({
          baseUrl: 'https://stood.fixture',
          key: 'key',
          secret: 'secret',
          clock: () => at,
          timeoutMs: 0,
        }),
    ).toThrow();
    const client = new StoodClient({
      baseUrl: 'http://127.0.0.1:3000',
      key: 'key',
      secret: 'secret',
      clock: () => NaN,
    });
    await expect(client.getDraft('alw')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

it('reads a held tranche through the public view and rejects malformed views (T-0187)', async () => {
  const { createTrancheRecord, advanceTrancheRecord } = await import('../domain/tranche-record.js');
  let record = createTrancheRecord({
    id: 'trn_1',
    amount: { minor: 120000, currency: 'USD' },
    profileId: 'code.final@1',
    maxResubmits: 1,
  });
  record = advanceTrancheRecord(record, { method: 'dispatch', args: ['auth_1', 'K7Q', at, at + 29 * 86400000] });
  const f = contract();
  f.store.tranche.mockResolvedValue({ trancheId: 'trn_1', version: 1, record, pending: null } as never);
  const view = await f.client.getTranche('trn_1');
  expect(view).toEqual({
    id: 'trn_1',
    state: 'HELD',
    version: 1,
    holdExpiresAt: new Date(at + 29 * 86400000).toISOString(),
    settlement: null,
    decision: null,
    // T-0189: the facts a platform needs to act on this read alone.
    amount: { minor: 120000, currency: 'USD' },
    packageId: 'pkg_1',
    resubmissionsLeft: 1,
    provider: 'simulator',
  });
  f.store.tranche.mockResolvedValue(null);
  await expect(f.client.getTranche('trn_1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const forged = new StoodClient({
    baseUrl: 'https://stood.fixture',
    key: 'fixture_key',
    secret: 'fixture_secret',
    clock: () => at,
    transport: async () =>
      new Response(
        JSON.stringify({ id: 'trn_other', state: 'HELD', version: 1, hold: null, settlement: null, decision: null }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
  });
  await expect(forged.getTranche('trn_1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

// C4 (#77): a platform asks Stood for a baseline and reads it back; the SDK refuses a result Stood did not record.
describe('Public SDK baselines against the actual local Stood HTTP router', () => {
  const view = (over: object = {}) => ({
    id: 'bl_1',
    status: 'DONE' as const,
    terms: { ...codeParams, minMutation: 0 },
    result: {
      tests: codeParams.testIds.map((id) => ({ id, status: 'FAIL' as const })),
      evidence: { key: `baselines/platform_a/bl_1/${'e'.repeat(64)}`, sha256: 'e'.repeat(64) },
    },
    createdAt: new Date(at).toISOString(),
    finishedAt: new Date(at).toISOString(),
    ...over,
  });
  const client = (stored: ReturnType<typeof view>) => {
    const baselines = { request: vi.fn(async () => stored), get: vi.fn(async () => stored) };
    const app = createApp({
      appEnv: 'ci',
      paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
      demoMode: false,
      api: {
        store: { create: vi.fn(), allowance: vi.fn(), tranche: vi.fn() },
        baselines,
        platformId: 'platform_a',
        key: 'fixture_key',
        secret: 'fixture_secret',
        clock: () => at,
      },
    });
    return {
      baselines,
      sdk: new StoodClient({
        baseUrl: 'https://stood.fixture',
        key: 'fixture_key',
        secret: 'fixture_secret',
        clock: () => at,
        transport: async (r: Request) => app.fetch(r),
      }),
    };
  };

  it('requests a baseline and reads every frozen test as it ran on the base commit', async () => {
    const { sdk, baselines } = client(view());
    const requested = await sdk.requestBaseline(codeParams, 'bl-key');
    expect(requested).toMatchObject({
      id: 'bl_1',
      status: 'DONE',
      baseCommit: codeParams.baseCommit,
      evidenceSha256: 'e'.repeat(64),
    });
    expect(requested.tests?.every((t) => t.status === 'FAIL')).toBe(true);
    expect(baselines.request).toHaveBeenCalledWith(
      'platform_a',
      'bl-key',
      expect.any(String),
      expect.objectContaining({ testIds: codeParams.testIds }),
    );
    expect(await sdk.getBaseline('bl_1')).toEqual(requested);
    const queued = client(view({ status: 'QUEUED', result: null, finishedAt: null }));
    expect(await queued.sdk.getBaseline('bl_1')).toMatchObject({ status: 'QUEUED', tests: null, evidenceSha256: null });
  });

  it('refuses a baseline response whose result does not match its status', async () => {
    for (const body of [
      {
        id: 'bl_1',
        status: 'DONE',
        repository: 'a/b',
        base_commit: 'a'.repeat(40),
        test_bundle_hash: 'b'.repeat(64),
        tests: null,
        evidence_sha256: null,
      },
      {
        id: 'bl_1',
        status: 'QUEUED',
        repository: 'a/b',
        base_commit: 'a'.repeat(40),
        test_bundle_hash: 'b'.repeat(64),
        tests: [{ id: 't', status: 'PASS' }],
        evidence_sha256: 'e'.repeat(64),
      },
      {
        id: 'bl_1',
        status: 'DONE',
        repository: 'a/b',
        base_commit: 'a'.repeat(40),
        test_bundle_hash: 'b'.repeat(64),
        tests: [{ id: 't', status: 'SKIP' }],
        evidence_sha256: 'e'.repeat(64),
      },
      {
        id: 'bl_other',
        status: 'QUEUED',
        repository: 'a/b',
        base_commit: 'a'.repeat(40),
        test_bundle_hash: 'b'.repeat(64),
        tests: null,
        evidence_sha256: null,
      },
    ]) {
      const sdk = new StoodClient({
        baseUrl: 'https://stood.fixture',
        key: 'fixture_key',
        secret: 'fixture_secret',
        clock: () => at,
        transport: async () => Response.json(body),
      });
      await expect(sdk.getBaseline('bl_1')).rejects.toBeInstanceOf(StoodClientError);
    }
  });
});

// C4 (#77): the platform forwards a usage receipt; Stood's refusal reaches the caller as a typed error.
describe('Public SDK usage confirmation against the actual local Stood HTTP router', () => {
  it('confirms use with a signed receipt and refuses a forged one', async () => {
    const { harness, usageReceipt, key, secret, now } = await import('../../test/fixtures/contract-app.js');
    const app = await harness();
    const sdk = new StoodClient({
      baseUrl: 'https://stood.fixture',
      key,
      secret,
      clock: () => now,
      transport: async (r: Request) => app.fetch(r),
    });
    expect(await sdk.confirmUsage('trn_1', usageReceipt())).toMatchObject({
      trancheId: 'trn_1',
      commit: 'b'.repeat(40),
    });
    await expect(sdk.confirmUsage('trn_1', { ...usageReceipt(), signature: 'Zm9yZ2Vk' })).rejects.toBeInstanceOf(
      StoodClientError,
    );
    const lying = new StoodClient({
      baseUrl: 'https://stood.fixture',
      key,
      secret,
      clock: () => now,
      transport: async () =>
        Response.json({ tranche_id: 'other', commit: 'b'.repeat(40), status: 'ACCEPTED', accepted_at: 'x' }),
    });
    await expect(lying.confirmUsage('trn_1', usageReceipt())).rejects.toBeInstanceOf(StoodClientError);
  });
});
