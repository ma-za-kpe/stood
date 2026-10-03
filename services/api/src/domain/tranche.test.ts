import { describe, expect, it } from 'vitest';
import { type CheckResult, decide, getProfile } from './decision.js';
import { Money } from './money.js';
import { Nonce } from './nonce.js';
import { Tranche } from './tranche.js';

const at = Date.parse('2026-10-03T00:00:00Z');
const expiry = at + 29 * 86400000;
const checks = (): CheckResult[] =>
  getProfile('construction.stage@1').checks.map((c) => ({ code: c.code, status: 'PASS', reason: 'passed' }));
const release = () => decide('construction.stage@1', checks());
const refuse = () =>
  decide('construction.stage@1', [{ code: 'location', status: 'FAIL', reason: 'wrong_plot', namedField: 'plot' }]);
const held = () => {
  const tranche = new Tranche('trn_test', new Money(400000n, 'GBP'), 'construction.stage@1', 2);
  tranche.dispatch('auth_1', new Nonce('K7Q'), at, expiry);
  return tranche;
};

describe('Tranche (FR-10–13, FR-38)', () => {
  it.each([-1, 6, 1.5])('rejects resubmit limit %s', (limit) => {
    expect(() => new Tranche('trn_test', new Money(1n, 'GBP'), 'construction.stage@1', limit)).toThrow();
  });
  it('rejects empty identifiers, zero amounts and unknown profiles', () => {
    expect(() => new Tranche('', new Money(1n, 'GBP'), 'construction.stage@1', 0)).toThrow();
    expect(() => new Tranche('trn_test', new Money(0n, 'GBP'), 'construction.stage@1', 0)).toThrow();
    expect(() => new Tranche('trn_test', new Money(1n, 'GBP'), 'unknown', 0)).toThrow();
  });
  it('does not dispatch before the hold is confirmed', () => {
    const tranche = new Tranche('trn_test', new Money(1n, 'GBP'), 'construction.stage@1', 0);
    expect(tranche.state).toBe('PENDING');
    expect(() => tranche.currentHold).toThrow();
    tranche.fundingFailed();
    expect(tranche.state).toBe('WAIT_FUNDING');
    expect(() => tranche.startDeciding()).toThrow();
    tranche.dispatch('auth_1', new Nonce('K7Q'), at, expiry);
    expect(tranche.state).toBe('HELD');
    expect(tranche.attempts).toHaveLength(1);
    expect(Object.isFrozen(tranche.attempts[0])).toBe(true);
  });
  it.each([
    ['', at, expiry],
    ['auth_1', Number.NaN, expiry],
    ['auth_1', at, at],
    ['auth_1', at, at + 30 * 86400000],
  ])('rejects invalid hold %s', (authorization, heldAt, expiresAt) => {
    const tranche = new Tranche('trn_test', new Money(1n, 'GBP'), 'construction.stage@1', 0);
    expect(() =>
      tranche.dispatch(authorization as string, new Nonce('K7Q'), heldAt as number, expiresAt as number),
    ).toThrow();
  });
  it('rejects illegal transitions and settlement without an operation', () => {
    const tranche = held();
    expect(() => tranche.dispatch('auth_2', new Nonce('K7Q'), at, expiry)).toThrow();
    expect(() => tranche.fundingFailed()).toThrow();
    expect(() => tranche.confirmSettlement('capture_1')).toThrow();
    expect(() => tranche.beginSettlement(release(), 'dec_1')).toThrow();
    expect(() => tranche.redispatch()).toThrow();
    expect(() => tranche.dispute()).toThrow();
  });
  it('requires confirmed capture before reporting RELEASED', () => {
    const tranche = held();
    tranche.startDeciding();
    const operation = tranche.beginSettlement(release(), 'dec_1');
    expect(operation?.effect).toBe('CAPTURE');
    expect(tranche.pendingOperation).toEqual(operation);
    expect(tranche.state).toBe('CAPTURE_PENDING');
    expect(() => tranche.confirmSettlement('')).toThrow();
    expect(() => tranche.beginSettlement(refuse(), 'dec_2')).toThrow();
    expect(() => tranche.expire(expiry)).toThrow();
    tranche.confirmSettlement('capture_1');
    expect(tranche.state).toBe('RELEASED');
    expect(tranche.settlement).toMatchObject({ effect: 'CAPTURE', reference: 'capture_1' });
    expect(() => tranche.confirmSettlement('capture_2')).toThrow();
    tranche.dispute();
    expect(tranche.state).toBe('DISPUTED');
    expect(tranche.settlement?.reference).toBe('capture_1');
  });
  it('voids a refusal and preserves old holds when redispatched', () => {
    const tranche = held();
    tranche.startDeciding();
    const first = tranche.beginSettlement(refuse(), 'dec_1');
    expect(tranche.state).toBe('VOID_PENDING');
    tranche.confirmSettlement('void_1');
    expect(tranche.state).toBe('REFUSED');
    tranche.redispatch();
    expect(tranche.settlement).toBeNull();
    expect(tranche.settlements).toEqual([{ effect: 'VOID', reference: 'void_1', attempt: 1 }]);
    expect(() => tranche.dispatch('auth_1', new Nonce('K7Q'), at, expiry)).toThrow();
    tranche.dispatch('auth_2', new Nonce('N8R'), at, expiry);
    tranche.startDeciding();
    const second = tranche.beginSettlement(refuse(), 'dec_2');
    expect(second?.key).not.toBe(first?.key);
    expect(tranche.attempts).toHaveLength(2);
    expect(tranche.decisions).toHaveLength(2);
  });
  it('enforces the resubmission cap', () => {
    const tranche = new Tranche('trn_test', new Money(1n, 'GBP'), 'construction.stage@1', 0);
    tranche.dispatch('auth_1', new Nonce('K7Q'), at, expiry);
    tranche.startDeciding();
    tranche.beginSettlement(refuse(), 'dec_1');
    tranche.confirmSettlement('void_1');
    expect(() => tranche.redispatch()).toThrow();
  });
  it('retains immutable WAIT history followed by a later decision', () => {
    const tranche = held();
    tranche.startDeciding();
    expect(tranche.beginSettlement(decide('construction.stage@1', []), 'dec_wait')).toBeNull();
    expect(tranche.state).toBe('WAITING');
    expect(tranche.decisions[0]?.decision.outcome).toBe('WAIT');
    expect(Object.isFrozen(tranche.decisions)).toBe(true);
    expect(() => tranche.beginSettlement(release(), 'dec_wait')).toThrow();
    expect(() => tranche.beginSettlement(release(), '')).toThrow();
    tranche.beginSettlement(release(), 'dec_release');
    tranche.confirmSettlement('capture_1');
    expect(tranche.decisions.map((d) => d.decision.outcome)).toEqual(['WAIT', 'RELEASE']);
  });
  it('rejects profile or payment-effect tampering', () => {
    const tranche = held();
    tranche.startDeciding();
    expect(() => tranche.beginSettlement({ ...release(), profileId: 'rental.return@1' }, 'dec_1')).toThrow();
    expect(() => tranche.beginSettlement({ ...release(), effect: 'VOID' }, 'dec_1')).toThrow();
    expect(() => tranche.beginSettlement({ ...refuse(), effect: 'CAPTURE' }, 'dec_1')).toThrow();
    expect(() =>
      tranche.beginSettlement({ ...decide('construction.stage@1', []), effect: 'CAPTURE' }, 'dec_1'),
    ).toThrow();
    expect(() => tranche.beginSettlement({ ...release(), outcome: 'INVALID' as 'RELEASE' }, 'dec_1')).toThrow();
    expect(() => tranche.beginSettlement({ ...release(), ruleSetVersion: 'unknown' }, 'dec_1')).toThrow();
    expect(() => tranche.beginSettlement({ ...release(), reason: '' }, 'dec_1')).toThrow();
    expect(() => tranche.beginSettlement({ ...refuse(), namedField: null }, 'dec_1')).toThrow();
    expect(tranche.decisions).toHaveLength(0);
  });
  it('returns a rental deposit using the declared VOID effect', () => {
    const tranche = new Tranche('trn_rental', new Money(10000n, 'GBP'), 'rental.return@1', 0);
    tranche.dispatch('auth_1', new Nonce('K7Q'), at, expiry);
    tranche.startDeciding();
    const passing: CheckResult[] = getProfile('rental.return@1').checks.map((c) => ({
      code: c.code,
      status: 'PASS',
      reason: 'passed',
    }));
    tranche.beginSettlement(decide('rental.return@1', passing), 'dec_1');
    expect(tranche.state).toBe('VOID_PENDING');
    tranche.confirmSettlement('void_1');
    expect(tranche.state).toBe('RELEASED');
    expect(tranche.settlement?.effect).toBe('VOID');
  });
  it.each(['HELD', 'DECIDING', 'WAITING'])('expires %s without releasing money', (state) => {
    const tranche = held();
    if (state !== 'HELD') tranche.startDeciding();
    if (state === 'WAITING') tranche.beginSettlement(decide('construction.stage@1', []), 'dec_wait');
    expect(() => tranche.expire(at)).toThrow();
    const operation = tranche.expire(expiry);
    expect(operation.effect).toBe('VOID');
    expect(tranche.state).toBe('VOID_PENDING');
    tranche.confirmSettlement('void_expired');
    expect(tranche.state).toBe('EXPIRED');
  });
});
