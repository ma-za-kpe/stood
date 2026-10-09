import { type KeyObject, sign } from 'node:crypto';
import type { FrozenCodeContract } from '../../ports/runner-report.js';

export type RunnerKey = Readonly<{ id: string; privateKey: KeyObject }>;
export type RunnerRun = Readonly<{
  contract: FrozenCodeContract;
  tests: readonly Readonly<{ id: string; status: 'PASS' | 'FAIL' | 'SKIP' }>[];
  diffHash: string;
  mutationScore: number;
  spentMinor: number;
  recordedAt: number;
}>;
export type SignedRunnerReport = Readonly<{ keyId: string; payload: string; signature: string }>;

// T-0159: signs a run as the report SignedReportVerifier accepts. It runs in the worker, outside the VM, so the
// untrusted code under test never touches the key. Bindings come from the frozen contract, never from the run.
export function signRunnerReport(key: RunnerKey, run: RunnerRun): SignedRunnerReport {
  const c = run.contract;
  const payload = JSON.stringify({
    platformId: c.platformId,
    allowanceId: c.allowanceId,
    packageId: c.packageId,
    repository: c.repository,
    baseCommit: c.baseCommit,
    commit: c.commit,
    manifestHash: c.manifestHash,
    runnerId: c.runnerId,
    imageDigest: c.imageDigest,
    testBundleHash: c.testBundleHash,
    tests: run.tests.map((t) => ({ id: t.id, status: t.status })),
    diffHash: run.diffHash,
    mutationScore: run.mutationScore,
    spentMinor: run.spentMinor,
    currency: c.currency,
    recordedAt: run.recordedAt,
    evidenceTier: 'attested',
  });
  const signature = sign(null, Buffer.from(`stood-runner-report/v1\0${key.id}\0${payload}`), key.privateKey);
  return Object.freeze({ keyId: key.id, payload, signature: signature.toString('base64') });
}
