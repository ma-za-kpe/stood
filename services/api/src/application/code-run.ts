import { createHash } from 'node:crypto';
import type { RunnerKey } from '../adapters/runner/report-signer.js';
import { signRunnerReport } from '../adapters/runner/report-signer.js';
import type { RunJob, RunResult } from '../adapters/runner/vercel-sandbox.js';
import { type CheckResult, decide, getProfile } from '../domain/decision.js';
import { restoreTrancheRecord } from '../domain/tranche-record.js';
import type { RepositoryReader } from '../ports/repository-reader.js';
import type { FrozenCodeContract, RunnerReportVerifier } from '../ports/runner-report.js';
import type { TrancheStore } from '../ports/tranche-store.js';
import { bundleHash, repositoryChecks } from './code-evidence.js';
import type { CodeTerms } from './code-terms.js';

export type RunnerJob = Readonly<{
  platformId: string;
  allowanceId: string;
  trancheId: string;
  packageId: string;
  profileId: string;
  amount: Readonly<{ minor: number; currency: string }>;
  // Loaded from the signed allowance, never from the package submission.
  terms: CodeTerms;
  // What the package submission claims; it must agree with the signed terms.
  package: Readonly<{ repository: string; baseCommit: string; commit: string }>;
  // Commits already submitted for this tranche: a resubmission must be new work.
  priorCommits: readonly string[];
}>;
type Deps = Readonly<{
  store: TrancheStore;
  reader: RepositoryReader &
    Readonly<{
      source(repository: string, commit: string): Promise<readonly Readonly<{ path: string; content: string }>[]>;
    }>;
  runner: Readonly<{ run(job: RunJob): Promise<RunResult> }>;
  key: RunnerKey;
  verifier: RunnerReportVerifier;
  runnerId: string;
  imageDigest: string;
  clock(): number;
}>;
const diffHash = (base: string, commit: string) =>
  createHash('sha256')
    .update(JSON.stringify([base, commit]))
    .digest('hex');
const rank = { FAIL: 2, UNCERTAIN: 1, PASS: 0 } as const;
// The same check from two sources (the signed run and the repository) counts as its worst result.
function merge(...sets: readonly (readonly CheckResult[])[]): CheckResult[] {
  const out = new Map<string, CheckResult>();
  for (const check of sets.flat()) {
    const seen = out.get(check.code);
    if (!seen || rank[check.status] > rank[seen.status]) out.set(check.code, check);
  }
  return [...out.values()];
}

// T-0159: turns one queued code package into exactly one recorded decision. The buyer's frozen tests run on the
// exact commit in the isolated runner (ADR-0026); the run is signed outside the VM and verified like any report;
// the read-only repository checks are merged in; and the decision rules decide. The reconciler then captures or
// voids. Anything unavailable decides nothing (WAIT): the package is tried again later and never passes by default.
export async function runCodeJob(job: RunnerJob, deps: Deps): Promise<'DECIDED' | 'WAIT' | 'ALREADY_DECIDED'> {
  const decisionId = `run:${job.packageId}`;
  const current = await deps.store.load(job.trancheId);
  const tranche = restoreTrancheRecord(current.record);
  if (tranche.decisions.some((d) => d.id === decisionId)) return 'ALREADY_DECIDED';
  if (!['HELD', 'WAITING'].includes(tranche.state) || current.pending) return 'WAIT';
  const t = job.terms;
  let checks: CheckResult[];
  if (job.package.repository !== t.repository || job.package.baseCommit !== t.baseCommit) {
    // The submission points at something other than what the buyer signed: refused, and nothing is run.
    checks = getProfile(job.profileId).checks.map(({ code }) =>
      code === 'test_integrity'
        ? {
            code,
            source: 'RULE',
            status: 'FAIL',
            reason: 'package_terms_mismatch',
            namedField: 'package_terms_mismatch',
          }
        : { code, source: 'RULE', status: 'UNCERTAIN', reason: 'not_run' },
    );
  } else {
    try {
      const paths = t.tests.map((x) => x.path);
      const frozen = await deps.reader.files(t.repository, t.baseCommit, paths);
      // The buyer's tests at the base commit must be exactly the ones signed; otherwise there is nothing to run.
      if (frozen.some((f) => f.kind !== 'file') || bundleHash(frozen) !== t.testBundleHash) return 'WAIT';
      const byPath = new Map(frozen.map((f) => [f.path, f.content]));
      const source = await deps.reader.source(t.repository, job.package.commit);
      const run = await deps.runner.run({
        source,
        frozenTests: t.tests.map((x) => ({ id: x.id, path: x.path, content: byPath.get(x.path) as string })),
      });
      const contract: FrozenCodeContract = {
        platformId: job.platformId,
        allowanceId: job.allowanceId,
        packageId: job.packageId,
        repository: t.repository,
        baseCommit: t.baseCommit,
        commit: job.package.commit,
        manifestHash: t.manifestHash,
        testBundleHash: t.testBundleHash,
        testIds: t.testIds,
        runnerId: deps.runnerId,
        imageDigest: deps.imageDigest,
        maxMinor: job.amount.minor,
        currency: job.amount.currency,
        minMutation: t.minMutation,
        profileId: job.profileId,
        priorDiffHashes: job.priorCommits.map((c) => diffHash(t.baseCommit, c)),
      };
      const report = signRunnerReport(deps.key, {
        contract,
        tests: run.tests,
        diffHash: diffHash(t.baseCommit, job.package.commit),
        // No mutation tool runs yet, so a milestone that demands a mutation floor cannot pass on it (ADR-0026).
        mutationScore: 0,
        spentMinor: 0,
        recordedAt: deps.clock(),
      });
      const signed = deps.verifier.verify(contract, report);
      if (!signed) return 'WAIT';
      const repository = await repositoryChecks(deps.reader, {
        repository: t.repository,
        base: t.baseCommit,
        commit: job.package.commit,
        testBundleHash: t.testBundleHash,
        testPaths: paths,
        // New dependencies are not allowed unless they were already in the buyer's base commit.
        dependencyAllowlist: Object.keys(await deps.reader.dependencies(t.repository, t.baseCommit)),
      });
      checks = merge(signed, repository);
    } catch {
      return 'WAIT';
    }
  }
  const decision = decide(job.profileId, checks);
  let snapshot = await deps.store.load(job.trancheId);
  if (restoreTrancheRecord(snapshot.record).state === 'HELD')
    snapshot = await deps.store.apply(job.trancheId, snapshot.version, `${decisionId}:start`, {
      method: 'startDeciding',
      args: [],
    });
  await deps.store.apply(job.trancheId, snapshot.version, decisionId, {
    method: 'beginSettlement',
    args: [decision, decisionId, deps.clock()],
  });
  return 'DECIDED';
}
