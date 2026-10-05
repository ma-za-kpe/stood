export const RULE_SET_VERSION = '1.1.0';
export const MODEL_REFUSAL_CONFIDENCE = 0.9;
export type Outcome = 'RELEASE' | 'REFUSE' | 'WAIT';
export type PaymentEffect = 'CAPTURE' | 'VOID' | 'NONE';
export type EvidenceDetail = Readonly<{ distance_m?: number; matched_package_id?: string }>;
export type CheckResult = Readonly<
  {
    code: string;
    status: 'PASS' | 'FAIL' | 'UNCERTAIN';
    reason: string;
    namedField?: string;
    detail?: EvidenceDetail;
  } & ({ source: 'RULE'; confidence?: never } | { source: 'MODEL'; confidence: number })
>;
export type EvidenceProfile = Readonly<{
  id: string;
  checks: readonly Readonly<{
    code: string;
    hardFailure: boolean;
    source: 'RULE' | 'MODEL';
    minPassConfidence: number | null;
  }>[];
  passEffect: 'CAPTURE' | 'VOID';
  failEffect: 'VOID' | 'REVIEW';
}>;
export type Decision = Readonly<{
  outcome: Outcome;
  effect: PaymentEffect;
  profileId: string;
  ruleSetVersion: string;
  namedField: string | null;
  reason: string;
  detail: EvidenceDetail | null;
}>;

const profile = (
  id: string,
  checks: readonly [string, boolean, 'RULE' | 'MODEL', number | null][],
  passEffect: 'CAPTURE' | 'VOID',
  failEffect: 'VOID' | 'REVIEW',
): EvidenceProfile =>
  Object.freeze({
    id,
    checks: Object.freeze(
      checks.map(([code, hardFailure, source, minPassConfidence]) =>
        Object.freeze({ code, hardFailure, source, minPassConfidence }),
      ),
    ),
    passEffect,
    failEffect,
  });

const profiles: Readonly<Record<string, EvidenceProfile>> = Object.freeze({
  'construction.stage@1': profile(
    'construction.stage@1',
    [
      ['required_items', true, 'RULE', null],
      ['capture_window', true, 'RULE', null],
      ['location', true, 'RULE', null],
      ['novelty', true, 'RULE', null],
      ['nonce', true, 'MODEL', 0.8],
      ['classifier_label', false, 'MODEL', 0.75],
      ['attestation', false, 'RULE', null],
    ],
    'CAPTURE',
    'VOID',
  ),
  'freelance.milestone@1': profile(
    'freelance.milestone@1',
    [
      ['required_items', true, 'RULE', null],
      ['artifact_hash', true, 'RULE', null],
      ['link_check', true, 'RULE', null],
      ['novelty', true, 'RULE', null],
      ['classifier_label', false, 'MODEL', 0.75],
    ],
    'CAPTURE',
    'VOID',
  ),
  'rental.return@1': profile(
    'rental.return@1',
    [
      ['required_items', true, 'RULE', null],
      ['capture_window', true, 'RULE', null],
      ['pair_match', true, 'MODEL', 0.9],
    ],
    'VOID',
    'REVIEW',
  ),
});

export function getProfile(id: string): EvidenceProfile {
  const value = Object.hasOwn(profiles, id) ? profiles[id] : undefined;
  if (!value) throw new RangeError('Unknown evidence profile');
  return value;
}

export function decide(profileId: string, checks: readonly CheckResult[]): Decision {
  const result = (
    outcome: Outcome,
    effect: PaymentEffect,
    reason: string,
    namedField: string | null = null,
    detail: EvidenceDetail | undefined = undefined,
  ): Decision =>
    Object.freeze({
      outcome,
      effect,
      profileId,
      ruleSetVersion: RULE_SET_VERSION,
      namedField,
      reason,
      detail: detail ? Object.freeze({ ...detail }) : null,
    });
  const selected = Object.hasOwn(profiles, profileId) ? profiles[profileId] : undefined;
  if (!selected) return result('WAIT', 'NONE', 'unknown_profile');
  const expected = new Map(selected.checks.map((c) => [c.code, c]));
  const received = new Map<string, CheckResult>();
  for (const check of checks) {
    if (!check || typeof check !== 'object' || !expected.has(check.code))
      return result('WAIT', 'NONE', 'invalid_check_results');
    const requirement = expected.get(check.code) as EvidenceProfile['checks'][number];
    if (
      received.has(check.code) ||
      !['PASS', 'FAIL', 'UNCERTAIN'].includes(check.status) ||
      typeof check.reason !== 'string' ||
      !check.reason.trim() ||
      check.source !== requirement.source ||
      (check.source === 'MODEL' &&
        (!Number.isFinite(check.confidence) || check.confidence < 0 || check.confidence > 1)) ||
      (check.source === 'RULE' && 'confidence' in check) ||
      !validDetail(check.detail) ||
      (check.status === 'FAIL' && check.code === 'location' && check.detail?.distance_m === undefined) ||
      (check.status === 'FAIL' && check.code === 'novelty' && check.detail?.matched_package_id === undefined) ||
      (check.status === 'FAIL' && (typeof check.namedField !== 'string' || !check.namedField.trim()))
    ) {
      return result('WAIT', 'NONE', 'invalid_check_results');
    }
    const minPass = requirement.minPassConfidence as number | null;
    const uncertainModel =
      check.source === 'MODEL' &&
      ((check.status === 'FAIL' && check.confidence < MODEL_REFUSAL_CONFIDENCE) ||
        (check.status === 'PASS' && check.confidence < (minPass as number)));
    received.set(check.code, uncertainModel ? { ...check, status: 'UNCERTAIN', reason: 'model_needs_review' } : check);
  }
  for (const requirement of selected.checks) {
    const check = received.get(requirement.code);
    if (requirement.hardFailure && check?.status === 'FAIL') {
      if (selected.failEffect === 'REVIEW')
        return result('WAIT', 'NONE', 'review_payment_amount', check.namedField, check.detail);
      return result('REFUSE', 'VOID', check.reason, check.namedField, check.detail);
    }
  }
  for (const requirement of selected.checks) {
    const check = received.get(requirement.code);
    if (!check) return result('WAIT', 'NONE', `missing_result:${requirement.code}`);
    if (check.status !== 'PASS') return result('WAIT', 'NONE', check.reason, null, check.detail);
  }
  return result('RELEASE', selected.passEffect, 'all_checks_passed');
}

function validDetail(detail: unknown): detail is EvidenceDetail | undefined {
  if (detail === undefined) return true;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false;
  const value = detail as EvidenceDetail;
  return (
    Object.keys(value).every((key) => key === 'distance_m' || key === 'matched_package_id') &&
    (value.distance_m === undefined || (Number.isFinite(value.distance_m) && value.distance_m >= 0)) &&
    (value.matched_package_id === undefined ||
      (typeof value.matched_package_id === 'string' && !!value.matched_package_id.trim()))
  );
}
