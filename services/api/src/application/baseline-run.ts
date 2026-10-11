import type { BaselineJob, BaselineStore } from '../ports/baseline-store.js';
import type { CodeRunner } from '../ports/code-runner.js';
import type { EvidenceStore } from '../ports/evidence-store.js';
import type { RepositoryReader } from '../ports/repository-reader.js';
import { bundleHash } from './code-evidence.js';
import { type Step, type Waiting, waitingOn } from './waiting.js';

type Deps = Readonly<{
  store: Pick<BaselineStore, 'finish'>;
  reader: RepositoryReader &
    Readonly<{
      source(repository: string, commit: string): Promise<readonly Readonly<{ path: string; content: string }>[]>;
    }>;
  runner: CodeRunner;
  evidence: EvidenceStore;
  runnerId: string;
  imageDigest: string;
  clock(): number;
}>;

// C4 (#77): runs one milestone's frozen tests on the base commit, in the same isolated runner that later judges the
// work (ADR-0026), and records each test's result. Tests missing or changed at the base, or that could not run there,
// are INVALID; anything
// unavailable (GitHub, the runner, the evidence bucket) leaves the baseline queued to try again.
export async function runBaseline(
  job: BaselineJob,
  deps: Deps,
  signal?: AbortSignal,
): Promise<'DONE' | 'INVALID' | Waiting> {
  const t = job.terms;
  let step: Step = 'GITHUB';
  try {
    const frozen = await deps.reader.files(
      t.repository,
      t.baseCommit,
      t.tests.map((x) => x.path),
    );
    if (
      frozen.length !== t.tests.length ||
      frozen.some((f) => f.kind !== 'file') ||
      bundleHash(frozen) !== t.testBundleHash
    ) {
      await deps.store.finish(job.id, { status: 'INVALID' });
      return 'INVALID';
    }
    const byPath = new Map(frozen.map((f) => [f.path, f.content]));
    const source = await deps.reader.source(t.repository, t.baseCommit);
    step = 'RUNNER';
    const run = await deps.runner.run(
      { source, frozenTests: t.tests.map((x) => ({ id: x.id, path: x.path, content: byPath.get(x.path) as string })) },
      signal,
    );
    const outcome = new Map(run.tests.map((r) => [r.id, r.outcome]));
    // Second audit (2026-10-11): red means an assertion failed against unfinished software. A test that could not
    // run at all (did not load, threw outside an assertion, skipped, timed out, missing from the run) proves nothing
    // about the work, so the baseline is INVALID and the buyer's tests go back for revision.
    if (t.testIds.some((id) => !['PASSED', 'ASSERTION_FAILED'].includes(outcome.get(id) ?? 'NOT_RUN'))) {
      step = 'STORE';
      await deps.store.finish(job.id, { status: 'INVALID' });
      return 'INVALID';
    }
    const tests = t.testIds.map((id) => ({
      id,
      status: outcome.get(id) === 'PASSED' ? ('PASS' as const) : ('FAIL' as const),
    }));
    step = 'EVIDENCE';
    const stored = await deps.evidence.put(
      `baselines/${job.platformId}/${job.id}`,
      Buffer.from(
        JSON.stringify({
          baselineId: job.id,
          terms: t,
          tests,
          installExitCode: run.installExitCode,
          runnerId: deps.runnerId,
          imageDigest: deps.imageDigest,
          recordedAt: deps.clock(),
        }),
      ),
      'application/json',
    );
    step = 'STORE';
    await deps.store.finish(job.id, {
      status: 'DONE',
      result: { tests, evidence: { key: stored.key, sha256: stored.sha256 } },
    });
    return 'DONE';
  } catch (error) {
    return waitingOn(step, error);
  }
}
