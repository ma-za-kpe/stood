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
      minMutation?: number;
    }>;
  }>[];
  window_days: number;
  max_resubmits: number;
}>;

// Stood's allowanceDraft canonicalizes code terms by materializing this default.
// Persist the same shape in Yard so a valid version receipt does not fail equality checks.
export function canonicalMandateRequest(request: MandateRequest): MandateRequest {
  return {
    ...request,
    milestones: request.milestones.map((milestone) => ({
      ...milestone,
      params: milestone.profile.startsWith('code.')
        ? { ...milestone.params, minMutation: milestone.params.minMutation ?? 0 }
        : { ...milestone.params },
    })),
  };
}
