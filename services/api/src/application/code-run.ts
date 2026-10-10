import { createHash } from 'node:crypto';
import { type CheckResult, decide, getProfile } from '../domain/decision.js';
import { restoreTrancheRecord } from '../domain/tranche-record.js';
import type { CodeRunner } from '../ports/code-runner.js';
import type { EvidenceStore } from '../ports/evidence-store.js';
import type { RepositoryReader } from '../ports/repository-reader.js';
import type { FrozenCodeContract, ReportSigner, RunnerReportVerifier } from '../ports/runner-report.js';
import { type LatestPackageGuard, type TrancheStore, TrancheStoreError } from '../ports/tranche-store.js';
import { bundleHash, repositoryChecks } from './code-evidence.js';
import type { CodeTerms } from './code-terms.js';
import { type Step, type Waiting, waitingOn } from './waiting.js';

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
  // C4 (#77): a verified usage receipt exists for this package's commit (final milestones).
  usageConfirmed?: boolean;
}>;
type Deps = Readonly<{
  store: TrancheStore & LatestPackageGuard;
  reader: RepositoryReader &
    Readonly<{
      source(repository: string, commit: string): Promise<readonly Readonly<{ path: string; content: string }>[]>;
    }>;
  runner: CodeRunner;
  signer: ReportSigner;
  verifier: RunnerReportVerifier;
  // Stood's own bucket: every signed run is stored before it can decide anything.
  evidence: EvidenceStore;
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
// exact commit in the isolated runner (ADR-0026); the run is signed outside the VM, verified like any report and
// stored in Stood's evidence bucket; the read-only repository checks are merged in; and the decision rules decide.
// The reconciler then captures or voids. Anything unavailable decides nothing (WAIT): the package is tried again
// later and never passes by default.
export async function runCodeJob(
  job: RunnerJob,
  deps: Deps,
): Promise<'DECIDED' | 'ALREADY_DECIDED' | 'SUPERSEDED' | Waiting> {
  // A final milestone is decided again, once, when its use is confirmed.
  const decisionId = job.usageConfirmed ? `usage:${job.packageId}` : `run:${job.packageId}`;
  const current = await deps.store.load(job.trancheId);
  const tranche = restoreTrancheRecord(current.record);
  if (tranche.decisions.some((d) => d.id === decisionId)) return 'ALREADY_DECIDED';
  // DECIDING: an earlier run stopped between starting and recording its decision; it is decided again.
  if (!['HELD', 'DECIDING', 'WAITING'].includes(tranche.state) || current.pending) return 'WAIT:TRANCHE_BUSY';
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
    let step: Step = 'GITHUB';
    try {
      const paths = t.tests.map((x) => x.path);
      const frozen = await deps.reader.files(t.repository, t.baseCommit, paths);
      // The buyer's tests at the base commit must be exactly the ones signed; otherwise there is nothing to run.
      if (frozen.some((f) => f.kind !== 'file') || bundleHash(frozen) !== t.testBundleHash)
        return 'WAIT:TESTS_NOT_AT_BASE';
      const byPath = new Map(frozen.map((f) => [f.path, f.content]));
      const source = await deps.reader.source(t.repository, job.package.commit);
      step = 'RUNNER';
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
      const report = deps.signer.sign({
        contract,
        tests: run.tests,
        diffHash: diffHash(t.baseCommit, job.package.commit),
        // No mutation tool runs yet, so a milestone that demands a mutation floor cannot pass on it (ADR-0026).
        mutationScore: 0,
        spentMinor: 0,
        recordedAt: deps.clock(),
      });
      step = 'SIGNATURE';
      const signed = deps.verifier.verify(contract, report);
      if (!signed) return waitingOn(step);
      step = 'EVIDENCE';
      // The signed run is evidence: stored (write-once, by its hash) before it decides, or nothing is decided.
      await deps.evidence.put(
        `runs/${job.platformId}/${job.trancheId}/${job.packageId}`,
        Buffer.from(JSON.stringify({ contract, report })),
        'application/json',
      );
      step = 'GITHUB';
      const repository = await repositoryChecks(deps.reader, {
        repository: t.repository,
        base: t.baseCommit,
        commit: job.package.commit,
        testBundleHash: t.testBundleHash,
        testPaths: paths,
        // New dependencies are not allowed unless they were already in the buyer's base commit.
        dependencyAllowlist: Object.keys(await deps.reader.dependencies(t.repository, t.baseCommit)),
      });
      checks = merge(
        signed,
        repository,
        job.usageConfirmed
          ? [{ code: 'usage_release', source: 'RULE', status: 'PASS', reason: 'outside_usage_confirmed' }]
          : [],
      );
    } catch (error) {
      return waitingOn(step, error);
    }
  }
  const decision = decide(job.profileId, checks);
  // A newer package arrived while this one ran: this run decides nothing, and the newer package is run instead.
  try {
    let snapshot = await deps.store.load(job.trancheId);
    if (restoreTrancheRecord(snapshot.record).state === 'HELD')
      snapshot = await deps.store.applyIfLatest(
        job.trancheId,
        snapshot.version,
        `${decisionId}:start`,
        { method: 'startDeciding', args: [] },
        job.packageId,
      );
    await deps.store.applyIfLatest(
      job.trancheId,
      snapshot.version,
      decisionId,
      { method: 'beginSettlement', args: [decision, decisionId, deps.clock()] },
      job.packageId,
    );
  } catch (error) {
    if (error instanceof TrancheStoreError && error.code === 'STALE_PACKAGE') return 'SUPERSEDED';
    throw error;
  }
  return 'DECIDED';
}
