export type Outcome = 'RELEASE' | 'REFUSE' | 'WAIT';
export type PaymentEffect = 'CAPTURE' | 'VOID' | 'NONE';
export type CheckResult = Readonly<{
  code: string;
  status: 'PASS' | 'FAIL' | 'UNCERTAIN';
  reason: string;
  namedField?: string;
}>;
export type EvidenceProfile = Readonly<{
  id: string;
  checks: readonly Readonly<{ code: string; hardFailure: boolean }>[];
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
}>;

const profile = (
  id: string,
  checks: readonly [string, boolean][],
  passEffect: 'CAPTURE' | 'VOID',
  failEffect: 'VOID' | 'REVIEW',
): EvidenceProfile =>
  Object.freeze({
    id,
    checks: Object.freeze(checks.map(([code, hardFailure]) => Object.freeze({ code, hardFailure }))),
    passEffect,
    failEffect,
  });

const profiles: Readonly<Record<string, EvidenceProfile>> = Object.freeze({
  'construction.stage@1': profile(
    'construction.stage@1',
    [
      ['required_items', true],
      ['capture_window', true],
      ['location', true],
      ['novelty', true],
      ['nonce', true],
      ['classifier_label', false],
      ['attestation', false],
    ],
    'CAPTURE',
    'VOID',
  ),
  'freelance.milestone@1': profile(
    'freelance.milestone@1',
    [
      ['required_items', true],
      ['artifact_hash', true],
      ['link_check', true],
      ['novelty', true],
      ['classifier_label', false],
    ],
    'CAPTURE',
    'VOID',
  ),
  'rental.return@1': profile(
    'rental.return@1',
    [
      ['required_items', true],
      ['capture_window', true],
      ['pair_match', true],
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
  ): Decision =>
    Object.freeze({
      outcome,
      effect,
      profileId,
      ruleSetVersion: '1.0.0',
      namedField,
      reason,
    });
  const selected = Object.hasOwn(profiles, profileId) ? profiles[profileId] : undefined;
  if (!selected) return result('WAIT', 'NONE', 'unknown_profile');
  const expected = new Set(selected.checks.map((c) => c.code));
  const received = new Map<string, CheckResult>();
  for (const check of checks) {
    if (
      !expected.has(check.code) ||
      received.has(check.code) ||
      !['PASS', 'FAIL', 'UNCERTAIN'].includes(check.status) ||
      !check.reason.trim() ||
      (check.status === 'FAIL' && !check.namedField?.trim())
    ) {
      return result('WAIT', 'NONE', 'invalid_check_results');
    }
    received.set(check.code, check);
  }
  for (const requirement of selected.checks) {
    const check = received.get(requirement.code);
    if (requirement.hardFailure && check?.status === 'FAIL') {
      if (selected.failEffect === 'REVIEW') return result('WAIT', 'NONE', 'review_payment_amount', check.namedField);
      return result('REFUSE', 'VOID', check.reason, check.namedField);
    }
  }
  for (const requirement of selected.checks) {
    const check = received.get(requirement.code);
    if (!check) return result('WAIT', 'NONE', `missing_result:${requirement.code}`);
    if (check.status !== 'PASS') return result('WAIT', 'NONE', check.reason);
  }
  return result('RELEASE', selected.passEffect, 'all_checks_passed');
}
