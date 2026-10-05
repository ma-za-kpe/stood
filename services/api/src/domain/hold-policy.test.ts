import { describe, expect, it } from 'vitest';
import { type CheckResult, decide, getProfile } from './decision.js';
import { CAPTURE_SAFETY_MARGIN_MS, captureAllowedAt } from './hold-policy.js';
import { Money } from './money.js';
import { Nonce } from './nonce.js';
import { Tranche } from './tranche.js';

const expiry = 86400000;
const checks: CheckResult[] = getProfile('construction.stage@1').checks.map(({ code, source }) => ({
  code,
  status: 'PASS',
  reason: 'passed',
  ...(source === 'MODEL' ? { source, confidence: 1 } : { source }),
}));
const release = decide('construction.stage@1', checks);
const held = () => {
  const t = new Tranche('trn_margin', new Money(1n, 'GBP'), 'construction.stage@1', 0);
  t.dispatch('auth_margin', new Nonce('K7Q'), 0, expiry);
  t.startDeciding();
  return t;
};
describe('Capture expiry margin (T-0129)', () => {
  it('closes captures five minutes before expiry', () => {
    expect(CAPTURE_SAFETY_MARGIN_MS).toBe(300000);
    expect(captureAllowedAt(expiry, expiry - 300001)).toBe(true);
    expect(captureAllowedAt(expiry, expiry - 300000)).toBe(false);
    expect(captureAllowedAt(expiry, expiry)).toBe(false);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(captureAllowedAt(value, 0)).toBe(false);
      expect(captureAllowedAt(expiry, value)).toBe(false);
    }
  });
  it('waits inside the margin and voids only at expiry', () => {
    const t = held();
    expect(t.settlementBlock).toBeNull();
    expect(t.beginSettlement(release, 'dec_margin', expiry - 300000)).toBeNull();
    expect(t.state).toBe('WAITING');
    expect(t.pendingOperation).toBeNull();
    expect(t.settlementBlock).toBe('CAPTURE_WINDOW_CLOSING');
    expect(() => t.expire(expiry - 1)).toThrow();
    expect(t.expire(expiry).effect).toBe('VOID');
    expect(t.settlementBlock).toBeNull();
  });
  it('still permits refusal or deposit return inside the capture margin', () => {
    const t = held();
    t.beginSettlement(release, 'dec_margin', expiry - 1);
    expect(
      t.beginSettlement(
        decide('construction.stage@1', [
          {
            code: 'required_items',
            source: 'RULE',
            status: 'FAIL',
            reason: 'missing_item',
            namedField: 'missing:north_wall',
          },
        ]),
        'dec_refuse',
        expiry - 1,
      )?.effect,
    ).toBe('VOID');
    expect(t.settlementBlock).toBeNull();
    const rental = new Tranche('trn_rental', new Money(1n, 'GBP'), 'rental.return@1', 0);
    rental.dispatch('auth_rental', new Nonce('K7Q'), 0, expiry);
    rental.startDeciding();
    const passing: CheckResult[] = getProfile('rental.return@1').checks.map(({ code, source }) => ({
      code,
      status: 'PASS',
      reason: 'passed',
      ...(source === 'MODEL' ? { source, confidence: 1 } : { source }),
    }));
    expect(rental.beginSettlement(decide('rental.return@1', passing), 'dec_return', expiry - 1)?.effect).toBe('VOID');
  });
  it('preserves an already reserved capture for reconciliation at the deadline', () => {
    const t = held();
    const op = t.beginSettlement(release, 'dec_capture', expiry - 300001);
    expect(op?.effect).toBe('CAPTURE');
    expect(() => t.expire(expiry)).toThrow();
    expect(t.pendingOperation).toBe(op);
  });
});
