import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type CheckResult, decide, getProfile } from './decision.js';

const passing = (id = 'construction.stage@1'): CheckResult[] =>
  getProfile(id).checks.map((check) => ({ code: check.code, status: 'PASS', reason: 'passed' }));

describe('Versioned evidence profiles and decisions (FR-37, NFR-02)', () => {
  it('releases only a complete passing construction package', () => {
    expect(decide('construction.stage@1', passing())).toMatchObject({
      outcome: 'RELEASE',
      effect: 'CAPTURE',
      profileId: 'construction.stage@1',
      ruleSetVersion: '1.0.0',
    });
  });
  it('supports digital evidence without a location check', () => {
    const profile = getProfile('freelance.milestone@1');
    expect(profile.checks.some((c) => c.code === 'location')).toBe(false);
    expect(decide(profile.id, passing(profile.id)).outcome).toBe('RELEASE');
  });
  it('fails closed for unknown profiles', () => {
    expect(() => getProfile('caller-code@1')).toThrow();
    expect(decide('caller-code@1', []).outcome).toBe('WAIT');
  });
  it('never releases an empty or incomplete result set', () => {
    const checks = passing();
    expect(decide('construction.stage@1', []).effect).toBe('NONE');
    for (let i = 0; i < checks.length; i++) {
      expect(
        decide(
          'construction.stage@1',
          checks.filter((_, n) => n !== i),
        ).outcome,
      ).toBe('WAIT');
    }
  });
  it('waits on every uncertain check', () => {
    for (const check of passing()) {
      const checks = passing().map((c) =>
        c.code === check.code ? { ...c, status: 'UNCERTAIN' as const, reason: 'needs_review' } : c,
      );
      expect(decide('construction.stage@1', checks)).toMatchObject({
        outcome: 'WAIT',
        effect: 'NONE',
        reason: 'needs_review',
      });
    }
  });
  it.each(['required_items', 'capture_window', 'location', 'novelty', 'nonce'])(
    'refuses a completed hard failure for %s',
    (code) => {
      const checks = passing().map((c) =>
        c.code === code ? { ...c, status: 'FAIL' as const, namedField: code, reason: 'failed' } : c,
      );
      expect(decide('construction.stage@1', checks)).toMatchObject({
        outcome: 'REFUSE',
        effect: 'VOID',
        namedField: code,
      });
    },
  );
  it('uses fixed refusal precedence regardless of arrival order', () => {
    const checks: CheckResult[] = [
      { code: 'location', status: 'FAIL', namedField: 'plot', reason: 'wrong_plot' },
      { code: 'required_items', status: 'FAIL', namedField: 'missing:overview', reason: 'missing_item' },
    ];
    expect(decide('construction.stage@1', checks).namedField).toBe('missing:overview');
    expect(decide('construction.stage@1', [...checks].reverse()).namedField).toBe('missing:overview');
  });
  it('keeps unqualified model stage failures and attestation failures in review', () => {
    for (const code of ['classifier_label', 'attestation']) {
      const checks = passing().map((c) => (c.code === code ? { ...c, status: 'FAIL' as const, namedField: code } : c));
      expect(decide('construction.stage@1', checks).outcome).toBe('WAIT');
    }
  });
  it('waits on duplicated, unexpected or malformed results', () => {
    const checks = passing();
    const invalid: CheckResult[][] = [
      [...checks, checks[0] as CheckResult],
      [...checks, { code: 'capture_now', status: 'PASS', reason: 'passed' }],
      checks.map((c) => ({ ...c, status: 'BROKEN' as 'PASS' })),
      checks.map((c) => ({ ...c, reason: '' })),
      [{ code: 'location', status: 'FAIL', reason: 'failed' }],
    ];
    for (const result of invalid) expect(decide('construction.stage@1', result).outcome).toBe('WAIT');
  });
  it('returns a deposit by voiding on a match and requires review for partial capture', () => {
    const checks = passing('rental.return@1');
    expect(decide('rental.return@1', checks)).toMatchObject({ outcome: 'RELEASE', effect: 'VOID' });
    const damage = checks.map((c) =>
      c.code === 'pair_match' ? { ...c, status: 'FAIL' as const, namedField: 'condition', reason: 'damage' } : c,
    );
    expect(decide('rental.return@1', damage)).toMatchObject({ outcome: 'WAIT', effect: 'NONE' });
    const missing = checks.map((c) =>
      c.code === 'required_items'
        ? { ...c, status: 'FAIL' as const, namedField: 'missing:front', reason: 'missing_item' }
        : c,
    );
    expect(decide('rental.return@1', missing).effect).toBe('NONE');
  });
  it('is deterministic and exposes immutable records', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(passing(), { minLength: 7, maxLength: 7 }), (checks) => {
        expect(decide('construction.stage@1', checks)).toEqual(decide('construction.stage@1', checks));
        expect(Object.isFrozen(decide('construction.stage@1', checks))).toBe(true);
      }),
    );
    expect(Object.isFrozen(getProfile('construction.stage@1'))).toBe(true);
    expect(Object.isFrozen(getProfile('construction.stage@1').checks)).toBe(true);
  });
});
