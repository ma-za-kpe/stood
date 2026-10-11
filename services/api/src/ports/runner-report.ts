import type { CheckResult } from '../domain/decision.js';

// Loaded from a trusted frozen agreement, never constructed from package POST metadata.
export type FrozenCodeContract = Readonly<{
  platformId: string;
  allowanceId: string;
  packageId: string;
  repository: string;
  baseCommit: string;
  commit: string;
  manifestHash: string;
  testBundleHash: string;
  testIds: readonly string[];
  runnerId: string;
  // SHA-256 of the runner's image tag and SDK version (a label, not the image's content digest; ADR-0026).
  imageDigest: string;
  maxMinor: number;
  currency: string;
  minMutation: number;
  profileId: string;
  priorDiffHashes: readonly string[];
}>;
export interface RunnerReportVerifier {
  verify(contract: FrozenCodeContract, envelope: unknown): readonly CheckResult[] | null;
}
// T-0159: a run as the signer receives it, and the signed envelope the verifier checks.
export type RunnerRun = Readonly<{
  contract: FrozenCodeContract;
  tests: readonly Readonly<{ id: string; status: 'PASS' | 'FAIL' | 'SKIP' }>[];
  diffHash: string;
  mutationScore: number;
  spentMinor: number;
  recordedAt: number;
}>;
export type SignedRunnerReport = Readonly<{ keyId: string; payload: string; signature: string }>;
export interface ReportSigner {
  sign(run: RunnerRun): SignedRunnerReport;
}
