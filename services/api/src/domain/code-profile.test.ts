import { describe, expect, it } from 'vitest';
import { type CheckResult, decide, getProfile } from './decision.js';

describe('Code milestone evidence profile', () => {
  const passed = (): CheckResult[] =>
    getProfile('code.milestone@1').checks.map(({ code }) => ({
      code,
      source: 'RULE',
      status: 'PASS',
      reason: 'synthetic_trusted_finding',
    }));
  it('requires deterministic evidence without a buyer or builder identity input', () => {
    expect(decide('code.milestone@1', passed())).toMatchObject({ outcome: 'RELEASE', effect: 'CAPTURE' });
    expect(getProfile('code.milestone@1').checks.every((c) => c.source === 'RULE')).toBe(true);
  });
  it.each(['test_integrity', 'test_execution', 'new_commit', 'budget_mandate'])(
    'refuses a definite %s violation with its reason',
    (code) => {
      expect(
        decide(
          'code.milestone@1',
          passed().map((c) =>
            c.code === code ? { ...c, status: 'FAIL', namedField: code, reason: 'frozen_contract_failed' } : c,
          ),
        ),
      ).toMatchObject({ outcome: 'REFUSE', namedField: code });
    },
  );
  it('waits for unsigned, weak or missing outside-usage evidence, including missing results', () => {
    for (const code of ['signed_tests', 'mutation_score', 'usage_release']) {
      expect(
        decide(
          'code.milestone@1',
          passed().map((c) => (c.code === code ? { ...c, status: 'UNCERTAIN', reason: 'evidence_needs_review' } : c)),
        ).outcome,
      ).toBe('WAIT');
    }
    expect(
      decide(
        'code.milestone@1',
        passed().map((c) =>
          c.code === 'mutation_score'
            ? { ...c, status: 'FAIL', namedField: 'mutation_score', reason: 'weak_tests' }
            : c,
        ),
      ).outcome,
    ).toBe('WAIT');
    expect(decide('code.milestone@1', []).outcome).toBe('WAIT');
  });
});
