import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryEvidence } from '../../test/fakes/evidence-store.js';
import { runBaseline } from './baseline-run.js';
import { bundleHash } from './code-evidence.js';

const base = 'a'.repeat(40);
const frozen = [
  { id: 't1', path: 'tests/a.test.js', content: 'buyer test a' },
  { id: 't2', path: 'tests/b.test.js', content: 'buyer test b' },
];
const manifest = frozen.map((t) => ({ id: t.id, path: t.path }));
const terms = {
  repository: 'buyer/app',
  baseCommit: base,
  testBundleHash: bundleHash(frozen),
  manifestHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
  testIds: ['t1', 't2'],
  tests: manifest,
  minMutation: 0,
};
const job = { id: 'bl_1', platformId: 'platform', terms };
function harness(
  o: { results?: ('PASS' | 'FAIL')[]; runner?: 'down'; atBase?: 'changed' | 'missing'; evidence?: 'down' } = {},
) {
  const finished: unknown[] = [];
  const evidence = new MemoryEvidence();
  evidence.down = o.evidence === 'down';
  const runs: unknown[] = [];
  const deps = {
    store: { finish: async (id: string, outcome: unknown) => void finished.push({ id, outcome }) },
    reader: {
      files: async (_r: string, _c: string, paths: readonly string[]) =>
        frozen
          .filter((t) => paths.includes(t.path) && !(o.atBase === 'missing' && t.id === 't2'))
          .map((t) => ({
            path: t.path,
            content: o.atBase === 'changed' && t.id === 't1' ? 'weaker test' : t.content,
            kind: 'file' as const,
          })),
      changedPaths: async () => [],
      descends: async () => true,
      dependencies: async () => ({}),
      source: async () => [{ path: 'src/app.js', content: 'export const todo = true;' }],
    },
    runner: {
      run: async (r: unknown) => {
        runs.push(r);
        if (o.runner === 'down') throw new Error('RUNNER_UNAVAILABLE');
        const s = o.results ?? ['FAIL', 'FAIL'];
        return { tests: frozen.map((t, i) => ({ id: t.id, status: s[i] as 'PASS' | 'FAIL' })), installExitCode: 0 };
      },
    },
    evidence,
    runnerId: 'stood-vercel-sandbox',
    imageDigest: 'e'.repeat(64),
    clock: () => 1790985600000,
  };
  return { deps, evidence, finished, runs };
}

// C4 (#77): the buyer's frozen tests must be red on the base commit before any work is posted.
describe('runBaseline', () => {
  it('runs the frozen tests on the base commit and records each result, with the run stored as evidence', async () => {
    const h = harness();
    expect(await runBaseline(job, h.deps)).toBe('DONE');
    expect(h.runs[0]).toMatchObject({ frozenTests: frozen, source: [{ path: 'src/app.js' }] });
    const [only] = h.finished as {
      id: string;
      outcome: { status: string; result: { tests: unknown; evidence: { key: string } } };
    }[];
    expect(only?.outcome.status).toBe('DONE');
    expect(only?.outcome.result.tests).toEqual([
      { id: 't1', status: 'FAIL' },
      { id: 't2', status: 'FAIL' },
    ]);
    expect(only?.outcome.result.evidence.key).toMatch(/^baselines\/platform\/bl_1\/[a-f0-9]{64}$/);
    expect(h.evidence.objects.size).toBe(1);
  });

  it('records a test that already passes on the base, so the platform can send it back for revision', async () => {
    const h = harness({ results: ['PASS', 'FAIL'] });
    expect(await runBaseline(job, h.deps)).toBe('DONE');
    expect((h.finished[0] as { outcome: { result: { tests: unknown } } }).outcome.result.tests).toEqual([
      { id: 't1', status: 'PASS' },
      { id: 't2', status: 'FAIL' },
    ]);
  });

  it('is invalid when the frozen tests at the base are missing or not the signed ones, without running anything', async () => {
    for (const atBase of ['changed', 'missing'] as const) {
      const h = harness({ atBase });
      expect(await runBaseline(job, h.deps)).toBe('INVALID');
      expect(h.finished).toEqual([{ id: 'bl_1', outcome: { status: 'INVALID' } }]);
      expect(h.runs).toEqual([]);
    }
  });

  it('waits, recording nothing, while the runner or the evidence bucket is unavailable', async () => {
    for (const o of [{ runner: 'down' as const }, { evidence: 'down' as const }]) {
      const h = harness(o);
      expect(await runBaseline(job, h.deps)).toBe('WAIT');
      expect(h.finished).toEqual([]);
    }
  });
});
