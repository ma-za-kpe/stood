import { describe, expect, it } from 'vitest';
import { type CheckResult, decide, getProfile } from './decision.js';
import { advanceTrancheRecord, createTrancheRecord, restoreTrancheRecord } from './tranche-record.js';

const passed = (profile: string): CheckResult[] =>
  getProfile(profile).checks.map(({ code }) => ({ code, source: 'RULE', status: 'PASS', reason: 'signed_fixture' }));
describe('Usage release belongs to final handover (T-0170)', () => {
  it('releases an intermediate milestone without any usage or buyer-touch finding', () => {
    const checks = passed('code.milestone@1').filter((c) => c.code !== 'usage_release');
    expect(decide('code.milestone@1', checks)).toMatchObject({ outcome: 'RELEASE', effect: 'CAPTURE' });
    expect(getProfile('code.milestone@1').checks.some((c) => c.code === 'usage_release')).toBe(false);
  });
  it('requires outside usage for final handover, even when every build check passes', () => {
    const checks = passed('code.final@1');
    expect(
      decide(
        'code.final@1',
        checks.filter((c) => c.code !== 'usage_release'),
      ).outcome,
    ).toBe('WAIT');
    expect(
      decide(
        'code.final@1',
        checks.map((c) => (c.code === 'usage_release' ? { ...c, status: 'UNCERTAIN', reason: 'usage_pending' } : c)),
      ).outcome,
    ).toBe('WAIT');
    expect(decide('code.final@1', checks)).toMatchObject({ outcome: 'RELEASE', effect: 'CAPTURE' });
  });
  it('restores a prior-rules live hold only in safe mode after this semantic change', () => {
    const initial = createTrancheRecord({
      id: 'old-code',
      amount: { minor: 120000, currency: 'USD' },
      profileId: 'code.milestone@1',
      maxResubmits: 0,
    });
    const record = JSON.parse(
      advanceTrancheRecord(initial, { method: 'dispatch', args: ['auth', 'K7Q', 1000, 1000000] }),
    );
    record.ruleSetVersion = '1.1.0';
    const restored = restoreTrancheRecord(JSON.stringify(record));
    expect(restored.safeRecovery).toBe(true);
    expect(() => restored.startDeciding()).toThrow();
  });
});
