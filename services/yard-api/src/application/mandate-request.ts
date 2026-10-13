export type MandateRequest = Readonly<{
  payee_ref: string;
  cap: Readonly<{ minor: number; currency: string }>;
  milestones: readonly Readonly<{
    name: string;
    amount: Readonly<{ minor: number; currency: string }>;
    profile: string;
    params: Readonly<{
      repository: string;
      baseCommit: string;
      testBundleHash: string;
      manifestHash: string;
      testIds: readonly string[];
      tests?: readonly Readonly<{ id: string; path: string }>[];
    }>;
  }>[];
  window_days: number;
  max_resubmits: number;
}>;
