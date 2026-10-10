import { createHash, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryEvidence } from '../../test/fakes/evidence-store.js';
import { MemoryTranches } from '../../test/fakes/tranche-store.js';
import { reportSigner } from '../adapters/runner/report-signer.js';
import { SignedReportVerifier } from '../adapters/runner/signed-report.js';
import { createTrancheRecord, restoreTrancheRecord } from '../domain/tranche-record.js';
import { bundleHash } from './code-evidence.js';
import { type RunnerJob, runCodeJob } from './code-run.js';

const now = 1790985600000;
const base = 'a'.repeat(40);
const commit = 'b'.repeat(40);
const frozen = [
  { id: 't1', path: 'tests/a.test.js', content: 'buyer test a' },
  { id: 't2', path: 'tests/b.test.js', content: 'buyer test b' },
];
const manifest = frozen.map((t) => ({ id: t.id, path: t.path }));
const keys = generateKeyPairSync('ed25519');
const key = { id: 'runner-key', privateKey: keys.privateKey };
const runnerId = 'stood-vercel-sandbox';
const verifier = new SignedReportVerifier(
  [{ id: key.id, runnerId, publicKey: keys.publicKey, notBefore: now - 1e6, notAfter: now + 1e6, revoked: false }],
  () => now,
);
function job(over: Partial<RunnerJob> = {}): RunnerJob {
  return {
    platformId: 'platform',
    allowanceId: 'allowance',
    trancheId: 'trn',
    packageId: 'pkg_1',
    profileId: 'code.milestone@1',
    amount: { minor: 1000, currency: 'USD' },
    terms: {
      repository: 'buyer/app',
      baseCommit: base,
      testBundleHash: bundleHash(frozen),
      manifestHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
      testIds: ['t1', 't2'],
      tests: manifest,
      minMutation: 0,
    },
    package: { repository: 'buyer/app', baseCommit: base, commit },
    priorCommits: [],
    ...over,
  };
}
async function harness(
  o: { results?: ('PASS' | 'FAIL')[]; runner?: 'down'; changedTestAtCommit?: boolean; evidence?: 'down' } = {},
) {
  const store = new MemoryTranches();
  await store.create(
    createTrancheRecord({
      id: 'trn',
      amount: { minor: 1000, currency: 'USD' },
      profileId: 'code.milestone@1',
      maxResubmits: 1,
    }),
  );
  const held = await store.load('trn');
  await store.apply('trn', held.version, 'dispatch', {
    method: 'dispatch',
    args: ['auth_1', 'K7Q', now - 1000, now + 28 * 86400000],
  });
  const runs: unknown[] = [];
  const reader = {
    files: async (_repo: string, at: string, paths: readonly string[]) =>
      frozen
        .filter((t) => paths.includes(t.path))
        .map((t) => ({
          path: t.path,
          content: at === commit && o.changedTestAtCommit && t.id === 't1' ? 'weakened' : t.content,
          kind: 'file' as const,
        })),
    changedPaths: async () => (o.changedTestAtCommit ? ['src/app.js', 'tests/a.test.js'] : ['src/app.js']),
    descends: async () => true,
    dependencies: async () => ({}),
    source: async () => [{ path: 'src/app.js', content: 'export const ok = true;' }],
  };
  const runner = {
    run: async (r: unknown) => {
      runs.push(r);
      if (o.runner === 'down') throw new Error('RUNNER_UNAVAILABLE');
      const statuses = o.results ?? ['PASS', 'PASS'];
      return {
        tests: frozen.map((t, i) => ({ id: t.id, status: statuses[i] as 'PASS' | 'FAIL' })),
        installExitCode: null,
      };
    },
  };
  const evidence = new MemoryEvidence();
  evidence.down = o.evidence === 'down';
  const deps = {
    store,
    evidence,
    reader,
    runner,
    signer: reportSigner(key),
    verifier,
    runnerId,
    imageDigest: 'e'.repeat(64),
    clock: () => now,
  };
  const state = async () => restoreTrancheRecord((await store.load('trn')).record);
  return { deps, evidence, runs, state, store };
}

// T-0159: a queued code package becomes exactly one recorded decision, from a signed and verified run of the buyer's
// frozen tests on the exact commit plus the read-only repository checks. Missing evidence decides nothing.
describe('runCodeJob', () => {
  it('releases when every frozen test passes on the exact commit, and runs the buyer tests, not the builder ones', async () => {
    const h = await harness();
    expect(await runCodeJob(job(), h.deps)).toBe('DECIDED');
    const t = await h.state();
    expect(t.state).toBe('CAPTURE_PENDING');
    expect(t.decisions.at(-1)?.decision).toMatchObject({ outcome: 'RELEASE', effect: 'CAPTURE' });
    expect(h.runs[0]).toMatchObject({ frozenTests: frozen, source: [{ path: 'src/app.js' }] });
  });

  it('stores the signed run in the evidence bucket before deciding, and decides nothing if it cannot', async () => {
    const h = await harness();
    expect(await runCodeJob(job(), h.deps)).toBe('DECIDED');
    const [stored] = [...h.evidence.objects];
    expect(stored).toBeDefined();
    const [key, body] = stored as [string, Buffer];
    expect(key).toMatch(/^runs\/platform\/trn\/pkg_1\/[a-f0-9]{64}$/);
    const run = JSON.parse(String(body));
    expect(run.contract).toMatchObject({ packageId: 'pkg_1', commit, runnerId });
    expect(run.report.signature).toEqual(expect.any(String));
    const down = await harness({ evidence: 'down' });
    expect(await runCodeJob(job(), down.deps)).toBe('WAIT');
    expect((await down.state()).state).toBe('HELD');
  });

  it('refuses when a frozen test fails, naming what failed', async () => {
    const h = await harness({ results: ['PASS', 'FAIL'] });
    expect(await runCodeJob(job(), h.deps)).toBe('DECIDED');
    const t = await h.state();
    expect(t.state).toBe('VOID_PENDING');
    expect(t.decisions.at(-1)?.decision).toMatchObject({ outcome: 'REFUSE', namedField: 'tests_failed' });
  });

  it('refuses a commit that changed the buyer tests, even when the run passes', async () => {
    const h = await harness({ changedTestAtCommit: true });
    expect(await runCodeJob(job(), h.deps)).toBe('DECIDED');
    expect((await h.state()).decisions.at(-1)?.decision).toMatchObject({
      outcome: 'REFUSE',
      namedField: 'signed_tests_changed',
    });
  });

  it('refuses a package that contradicts the signed terms, without running it', async () => {
    const h = await harness();
    expect(await runCodeJob(job({ package: { repository: 'someone/else', baseCommit: base, commit } }), h.deps)).toBe(
      'DECIDED',
    );
    expect((await h.state()).decisions.at(-1)?.decision).toMatchObject({
      outcome: 'REFUSE',
      namedField: 'package_terms_mismatch',
    });
    expect(h.runs).toEqual([]);
  });

  it('decides nothing while the runner or the frozen tests are unavailable, and never runs a package twice', async () => {
    const down = await harness({ runner: 'down' });
    expect(await runCodeJob(job(), down.deps)).toBe('WAIT');
    expect((await down.state()).state).toBe('HELD');
    const wrongBundle = await harness();
    expect(await runCodeJob(job({ terms: { ...job().terms, testBundleHash: 'f'.repeat(64) } }), wrongBundle.deps)).toBe(
      'WAIT',
    );
    expect((await wrongBundle.state()).state).toBe('HELD');
    const once = await harness();
    expect(await runCodeJob(job(), once.deps)).toBe('DECIDED');
    expect(await runCodeJob(job(), once.deps)).toBe('ALREADY_DECIDED');
    expect(once.runs).toHaveLength(1);
  });

  it('leaves a final milestone waiting for the buyer to confirm use, even when every test passes', async () => {
    const h = await harness();
    await h.store.create(
      createTrancheRecord({
        id: 'fin',
        amount: { minor: 1000, currency: 'USD' },
        profileId: 'code.final@1',
        maxResubmits: 1,
      }),
    );
    const v = await h.store.load('fin');
    await h.store.apply('fin', v.version, 'd', {
      method: 'dispatch',
      args: ['auth_2', 'K7R', now - 1000, now + 28 * 86400000],
    });
    expect(await runCodeJob(job({ trancheId: 'fin', profileId: 'code.final@1' }), h.deps)).toBe('DECIDED');
    const t = restoreTrancheRecord((await h.store.load('fin')).record);
    expect(t.state).toBe('WAITING');
    expect(t.decisions.at(-1)?.decision).toMatchObject({ outcome: 'WAIT', reason: 'missing_result:usage_release' });
  });
});
