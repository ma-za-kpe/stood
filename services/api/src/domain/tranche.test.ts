import fc from 'fast-check';
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

describe('Settlement review regressions', () => {
  it.each([expiry, expiry + 1])('reserves expiry void rather than capture at %s', (now) => {
    const tranche = held();
    tranche.startDeciding();
    expect(tranche.beginSettlement(release(), 'dec_late', now)).toMatchObject({ effect: 'VOID', target: 'EXPIRED' });
  });
  it('rejects invalid decision clocks without changing history', () => {
    const tranche = held();
    tranche.startDeciding();
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, at - 1]) {
      expect(() => tranche.beginSettlement(release(), 'dec_invalid', now)).toThrow();
    }
    expect(tranche.decisions).toHaveLength(0);
  });
  it('matches confirmation effect and authorisation to the reservation', () => {
    const tranche = held();
    tranche.startDeciding();
    tranche.beginSettlement(refuse(), 'dec_refuse', at);
    for (const confirmation of [
      { effect: 'CAPTURE', authorizationId: 'auth_1', reference: 'capture_wrong' },
      { effect: 'VOID', authorizationId: 'auth_other', reference: 'void_wrong' },
    ] as const)
      expect(() => tranche.confirmSettlement(confirmation)).toThrow();
    expect(tranche.state).toBe('VOID_PENDING');
    expect(tranche.settlements).toHaveLength(0);
  });
  it.each(['CAPTURE', 'VOID'] as const)('handles definite and ambiguous %s failures', (effect) => {
    for (const kind of ['DECLINED', 'SYSTEM_FAULT', 'AMBIGUOUS', 'AUTHORIZATION_EXPIRED'] as const) {
      const tranche = held();
      tranche.startDeciding();
      tranche.beginSettlement(effect === 'CAPTURE' ? release() : refuse(), 'dec_1', at);
      expect(() =>
        tranche.settlementFailed({ kind: 'UNKNOWN' as 'SYSTEM_FAULT', effect, authorizationId: 'auth_1' }),
      ).toThrow();
      expect(() =>
        tranche.settlementFailed({ kind, effect, authorizationId: 'wrong', reference: 'failure' }),
      ).toThrow();
      if (kind === 'AUTHORIZATION_EXPIRED') {
        expect(() => tranche.settlementFailed({ kind, effect, authorizationId: 'auth_1' })).toThrow();
        expect(() => tranche.settlementFailed({ kind, effect, authorizationId: 'auth_1', reference: '' })).toThrow();
      }
      tranche.settlementFailed({ kind, effect, authorizationId: 'auth_1', reference: 'provider_failure' });
      if (kind === 'AMBIGUOUS') {
        expect(tranche.state).toBe(`${effect}_PENDING`);
        expect(tranche.pendingOperation?.effect).toBe(effect);
      } else if (kind === 'AUTHORIZATION_EXPIRED') {
        expect(tranche.state).toBe('EXPIRED');
        expect(tranche.settlement).toMatchObject({ effect: 'EXPIRE', reference: 'provider_failure' });
        expect(tranche.pendingOperation).toBeNull();
      } else {
        expect(tranche.state).toBe('WAITING');
        expect(tranche.pendingOperation).toBeNull();
        expect(tranche.expire(expiry).effect).toBe('VOID');
      }
    }
    expect(() => held().settlementFailed({ kind: 'SYSTEM_FAULT', effect, authorizationId: 'auth_1' })).toThrow();
  });
  it('preserves money safety through arbitrary operation sequences', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            action: fc.integer({ min: 0, max: 9 }),
            now: fc.integer({ min: at, max: expiry + 1000 }),
          }),
          { maxLength: 100 },
        ),
        (commands) => {
          const tranche = held();
          let lastNow = at;
          for (const [index, { action, now }] of commands.entries()) {
            lastNow = Math.max(lastNow, now);
            const before = tranche.pendingOperation;
            try {
              switch (action) {
                case 0:
                  tranche.startDeciding();
                  break;
                case 1:
                case 2: {
                  const operation = tranche.beginSettlement(
                    action === 1 ? release() : refuse(),
                    `dec_${index}`,
                    lastNow,
                  );
                  if (operation?.effect === 'CAPTURE') expect(lastNow).toBeLessThan(tranche.currentHold.expiresAt);
                  break;
                }
                case 3:
                  tranche.expire(lastNow);
                  break;
                case 4:
                  tranche.confirmSettlement({
                    effect: before?.effect ?? 'CAPTURE',
                    authorizationId: tranche.currentHold.authorizationId,
                    reference: `ref_${index}`,
                  });
                  break;
                case 5:
                  tranche.settlementFailed({
                    kind: 'AMBIGUOUS',
                    effect: before?.effect ?? 'CAPTURE',
                    authorizationId: tranche.currentHold.authorizationId,
                  });
                  break;
                case 6:
                  tranche.settlementFailed({
                    kind: 'SYSTEM_FAULT',
                    effect: before?.effect ?? 'CAPTURE',
                    authorizationId: tranche.currentHold.authorizationId,
                  });
                  break;
                case 7:
                  tranche.settlementFailed({
                    kind: 'AUTHORIZATION_EXPIRED',
                    effect: before?.effect ?? 'CAPTURE',
                    authorizationId: tranche.currentHold.authorizationId,
                    reference: `expired_${index}`,
                  });
                  break;
                case 8:
                  tranche.dispute();
                  break;
                case 9:
                  tranche.redispatch();
                  tranche.dispatch(`auth_${index + 2}`, new Nonce('N8R'), lastNow, lastNow + 86400000);
                  break;
              }
            } catch (error) {
              // Only domain transition errors are expected; assertion failures must escape.
              if (
                !(error instanceof Error) ||
                !/^(Invalid transition|Resubmission limit reached|Hold has not expired|Settlement does not match)/.test(
                  error.message,
                )
              )
                throw error;
            }
            const attempts = tranche.settlements.map((s) => s.attempt);
            expect(new Set(attempts).size).toBe(attempts.length);
            if (['RELEASED', 'REFUSED', 'EXPIRED', 'DISPUTED'].includes(tranche.state)) {
              expect(tranche.settlement).not.toBeNull();
              expect(tranche.settlement?.attempt).toBe(tranche.attempts.length);
              if (tranche.state === 'RELEASED' || tranche.state === 'DISPUTED')
                expect(tranche.settlement?.effect).toBe('CAPTURE');
              if (tranche.state === 'REFUSED') expect(tranche.settlement?.effect).toBe('VOID');
              if (tranche.state === 'EXPIRED') expect(['VOID', 'EXPIRE']).toContain(tranche.settlement?.effect);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});

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
    expect(() =>
      tranche.confirmSettlement({ effect: 'CAPTURE', authorizationId: 'auth_1', reference: 'capture_1' }),
    ).toThrow();
    expect(() => tranche.beginSettlement(release(), 'dec_1', at)).toThrow();
    expect(() => tranche.redispatch()).toThrow();
    expect(() => tranche.dispute()).toThrow();
  });
  it('requires confirmed capture before reporting RELEASED', () => {
    const tranche = held();
    tranche.startDeciding();
    const operation = tranche.beginSettlement(release(), 'dec_1', at);
    expect(operation?.effect).toBe('CAPTURE');
    expect(tranche.pendingOperation).toEqual(operation);
    expect(tranche.state).toBe('CAPTURE_PENDING');
    expect(() => tranche.confirmSettlement({ effect: 'CAPTURE', authorizationId: 'auth_1', reference: '' })).toThrow();
    expect(() => tranche.beginSettlement(refuse(), 'dec_2', at)).toThrow();
    expect(() => tranche.expire(expiry)).toThrow();
    tranche.confirmSettlement({ effect: 'CAPTURE', authorizationId: 'auth_1', reference: 'capture_1' });
    expect(tranche.state).toBe('RELEASED');
    expect(tranche.settlement).toMatchObject({ effect: 'CAPTURE', reference: 'capture_1' });
    expect(() =>
      tranche.confirmSettlement({ effect: 'CAPTURE', authorizationId: 'auth_1', reference: 'capture_2' }),
    ).toThrow();
    tranche.dispute();
    expect(tranche.state).toBe('DISPUTED');
    expect(tranche.settlement?.reference).toBe('capture_1');
  });
  it('voids a refusal and preserves old holds when redispatched', () => {
    const tranche = held();
    tranche.startDeciding();
    const first = tranche.beginSettlement(refuse(), 'dec_1', at);
    expect(tranche.state).toBe('VOID_PENDING');
    tranche.confirmSettlement({ effect: 'VOID', authorizationId: 'auth_1', reference: 'void_1' });
    expect(tranche.state).toBe('REFUSED');
    tranche.redispatch();
    expect(tranche.settlement).toBeNull();
    expect(tranche.settlements).toEqual([{ effect: 'VOID', reference: 'void_1', attempt: 1 }]);
    expect(() => tranche.dispatch('auth_1', new Nonce('K7Q'), at, expiry)).toThrow();
    tranche.dispatch('auth_2', new Nonce('N8R'), at, expiry);
    tranche.startDeciding();
    const second = tranche.beginSettlement(refuse(), 'dec_2', at);
    expect(second?.key).not.toBe(first?.key);
    expect(tranche.attempts).toHaveLength(2);
    expect(tranche.decisions).toHaveLength(2);
  });
  it('enforces the resubmission cap', () => {
    const tranche = new Tranche('trn_test', new Money(1n, 'GBP'), 'construction.stage@1', 0);
    tranche.dispatch('auth_1', new Nonce('K7Q'), at, expiry);
    tranche.startDeciding();
    tranche.beginSettlement(refuse(), 'dec_1', at);
    tranche.confirmSettlement({ effect: 'VOID', authorizationId: 'auth_1', reference: 'void_1' });
    expect(() => tranche.redispatch()).toThrow();
  });
  it('retains immutable WAIT history followed by a later decision', () => {
    const tranche = held();
    tranche.startDeciding();
    expect(tranche.beginSettlement(decide('construction.stage@1', []), 'dec_wait', at)).toBeNull();
    expect(tranche.state).toBe('WAITING');
    expect(tranche.decisions[0]?.decision.outcome).toBe('WAIT');
    expect(Object.isFrozen(tranche.decisions)).toBe(true);
    expect(() => tranche.beginSettlement(release(), 'dec_wait', at)).toThrow();
    expect(() => tranche.beginSettlement(release(), '', at)).toThrow();
    tranche.beginSettlement(release(), 'dec_release', at);
    tranche.confirmSettlement({ effect: 'CAPTURE', authorizationId: 'auth_1', reference: 'capture_1' });
    expect(tranche.decisions.map((d) => d.decision.outcome)).toEqual(['WAIT', 'RELEASE']);
  });
  it('rejects profile or payment-effect tampering', () => {
    const tranche = held();
    tranche.startDeciding();
    expect(() => tranche.beginSettlement({ ...release(), profileId: 'rental.return@1' }, 'dec_1', at)).toThrow();
    expect(() => tranche.beginSettlement({ ...release(), effect: 'VOID' }, 'dec_1', at)).toThrow();
    expect(() => tranche.beginSettlement({ ...refuse(), effect: 'CAPTURE' }, 'dec_1', at)).toThrow();
    expect(() =>
      tranche.beginSettlement({ ...decide('construction.stage@1', []), effect: 'CAPTURE' }, 'dec_1', at),
    ).toThrow();
    expect(() => tranche.beginSettlement({ ...release(), outcome: 'INVALID' as 'RELEASE' }, 'dec_1', at)).toThrow();
    expect(() => tranche.beginSettlement({ ...release(), ruleSetVersion: 'unknown' }, 'dec_1', at)).toThrow();
    expect(() => tranche.beginSettlement({ ...release(), reason: '' }, 'dec_1', at)).toThrow();
    expect(() => tranche.beginSettlement({ ...refuse(), namedField: null }, 'dec_1', at)).toThrow();
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
    tranche.beginSettlement(decide('rental.return@1', passing), 'dec_1', at);
    expect(tranche.state).toBe('VOID_PENDING');
    tranche.confirmSettlement({ effect: 'VOID', authorizationId: 'auth_1', reference: 'void_1' });
    expect(tranche.state).toBe('RELEASED');
    expect(tranche.settlement?.effect).toBe('VOID');
  });
  it.each(['HELD', 'DECIDING', 'WAITING'])('expires %s without releasing money', (state) => {
    const tranche = held();
    if (state !== 'HELD') tranche.startDeciding();
    if (state === 'WAITING') tranche.beginSettlement(decide('construction.stage@1', []), 'dec_wait', at);
    expect(() => tranche.expire(at)).toThrow();
    const operation = tranche.expire(expiry);
    expect(operation.effect).toBe('VOID');
    expect(tranche.state).toBe('VOID_PENDING');
    tranche.confirmSettlement({ effect: 'VOID', authorizationId: 'auth_1', reference: 'void_expired' });
    expect(tranche.state).toBe('EXPIRED');
  });
});
