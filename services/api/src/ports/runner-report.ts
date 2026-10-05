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
