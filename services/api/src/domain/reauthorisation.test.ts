import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decide, getProfile } from './decision.js';
import { CAPTURE_SAFETY_MARGIN_MS } from './hold-policy.js';
import { Money } from './money.js';
import { Nonce } from './nonce.js';
import { type ReauthorizationFailure, Tranche } from './tranche.js';

const at = Date.parse('2026-10-03T00:00:00Z');
const day = 86400000;
const due = at + 3 * day;
const expiry = at + 29 * day;
const held = () => {
  const tranche = new Tranche('trn_renew', new Money(100n, 'GBP'), 'construction.stage@1', 1);
  tranche.dispatch('auth_original', new Nonce('K7Q'), at, expiry);
  return tranche;
};
const release = () =>
  decide(
    'construction.stage@1',
    getProfile('construction.stage@1').checks.map((check) => ({
      code: check.code,
      status: 'PASS' as const,
      reason: 'passed',
      ...(check.source === 'MODEL' ? { source: 'MODEL' as const, confidence: 1 } : { source: 'RULE' as const }),
    })),
  );
const confirmation = (tranche: Tranche, confirmedAt = due, authorizationId = 'auth_renewed') => ({
  effect: 'REAUTHORIZE' as const,
  key: tranche.pendingReauthorization?.key ?? 'unknown',
  previousAuthorizationId: 'auth_original',
  authorizationId,
  confirmedAt,
  expiresAt: expiry,
});

describe('Day-four reauthorisation (T-0134)', () => {
  it.each([at - 1, due - 1, Number.NaN, Number.POSITIVE_INFINITY, expiry - CAPTURE_SAFETY_MARGIN_MS, expiry])(
    'rejects renewal outside its safe window at %s without mutation',
    (now) => {
      const tranche = held();
      expect(() => tranche.beginReauthorization(now)).toThrow();
      expect(tranche.state).toBe('HELD');
      expect(tranche.pendingReauthorization).toBeNull();
    },
  );
  it.each(['HELD', 'DECIDING', 'WAITING'] as const)(
    'restores %s after renewal without resetting the visit',
    (state) => {
      const tranche = held();
      if (state !== 'HELD') tranche.startDeciding();
      if (state === 'WAITING') tranche.beginSettlement(decide('construction.stage@1', []), 'wait', at);
      const original = tranche.currentHold;
      const operation = tranche.beginReauthorization(due);
      expect(operation).toMatchObject({ effect: 'REAUTHORIZE', authorizationId: 'auth_original', requestedAt: due });
      expect(tranche.state).toBe('REAUTHORIZE_PENDING');
      expect(Object.isFrozen(operation)).toBe(true);
      expect(() => tranche.beginSettlement(release(), 'racing', due)).toThrow();
      expect(() => tranche.expire(expiry)).toThrow();
      expect(() => tranche.beginReauthorization(due)).toThrow();
      expect(() =>
        tranche.confirmSettlement({ effect: 'VOID', authorizationId: 'auth_original', reference: 'void' }),
      ).toThrow();
      tranche.confirmReauthorization(confirmation(tranche));
      expect(tranche.state).toBe(state);
      expect(tranche.currentHold).toEqual({ ...original, authorizationId: 'auth_renewed' });
      expect(tranche.attempts).toEqual([original]);
      expect(tranche.settlements).toEqual([]);
      expect(tranche.reauthorizations).toHaveLength(1);
      expect(Object.isFrozen(tranche.reauthorizations)).toBe(true);
      expect(Object.isFrozen(tranche.reauthorizations[0])).toBe(true);
      expect(() => tranche.beginReauthorization(due + 3 * day - 1)).toThrow();
      if (state === 'HELD') tranche.startDeciding();
      const capture = tranche.beginSettlement(release(), 'capture', due + 1);
      expect(capture?.authorizationId).toBe('auth_renewed');
      expect(() => tranche.beginReauthorization(due + 3 * day)).toThrow();
    },
  );
  it('keeps ambiguous renewals reserved and changes identity only on definite rejection', () => {
    const tranche = held();
    const operation = tranche.beginReauthorization(due);
    const failure = { effect: 'REAUTHORIZE' as const, key: operation.key, authorizationId: operation.authorizationId };
    tranche.reauthorizationFailed({ ...failure, kind: 'AMBIGUOUS' });
    expect(tranche.pendingReauthorization).toBe(operation);
    expect(() =>
      tranche.reauthorizationFailed({ ...failure, key: 'wrong', kind: 'REJECTED_NO_REAUTHORIZATION' }),
    ).toThrow();
    expect(() => tranche.reauthorizationFailed({ ...failure, authorizationId: 'wrong', kind: 'AMBIGUOUS' })).toThrow();
    expect(() =>
      tranche.reauthorizationFailed({ ...failure, effect: 'VOID' as 'REAUTHORIZE', kind: 'AMBIGUOUS' }),
    ).toThrow();
    expect(() => tranche.reauthorizationFailed({ ...failure, kind: 'DECLINED' as 'AMBIGUOUS' })).toThrow();
    tranche.reauthorizationFailed({ ...failure, kind: 'REJECTED_NO_REAUTHORIZATION' });
    expect(tranche.state).toBe('HELD');
    expect(tranche.currentHold.authorizationId).toBe('auth_original');
    expect(tranche.beginReauthorization(due).key).not.toBe(operation.key);
    expect(() => tranche.reauthorizationFailed({ ...failure, kind: 'REJECTED_NO_REAUTHORIZATION' })).toThrow();
    const renewalFailure: ReauthorizationFailure = { ...failure, kind: 'AMBIGUOUS' };
    // @ts-expect-error Renewal results must never enter capture/void failure handling.
    expect(() => tranche.settlementFailed(renewalFailure)).toThrow();
  });
  it('respects a shorter provider expiry after renewal', () => {
    const tranche = held();
    tranche.beginReauthorization(due);
    tranche.confirmReauthorization({ ...confirmation(tranche), expiresAt: due + day });
    tranche.startDeciding();
    expect(tranche.beginSettlement(release(), 'late', due + day)).toMatchObject({
      effect: 'VOID',
      target: 'EXPIRED',
      authorizationId: 'auth_renewed',
    });
  });
  it('rejects mismatched and malformed confirmations without losing the reservation', () => {
    const tranche = held();
    tranche.beginReauthorization(due);
    const valid = confirmation(tranche);
    for (const change of [
      { key: 'wrong' },
      { previousAuthorizationId: 'wrong' },
      { effect: 'CAPTURE' },
      { authorizationId: '' },
      { authorizationId: 'auth_original' },
      { confirmedAt: Number.NaN },
      { confirmedAt: due - 1 },
      { expiresAt: Number.POSITIVE_INFINITY },
      { expiresAt: due },
      { expiresAt: expiry + 1 },
    ])
      expect(() => tranche.confirmReauthorization({ ...valid, ...change } as typeof valid)).toThrow();
    expect(tranche.reauthorizations).toEqual([]);
    tranche.confirmReauthorization(valid);
    expect(() => tranche.confirmReauthorization(valid)).toThrow();
    expect(tranche.pendingReauthorization).toBeNull();
  });
  it('uses renewed authorisation for expiry and prevents recycling its id after redispatch', () => {
    const tranche = held();
    tranche.beginReauthorization(due);
    tranche.confirmReauthorization(confirmation(tranche));
    tranche.startDeciding();
    const refuse = decide('construction.stage@1', [
      {
        code: 'required_items',
        source: 'RULE',
        status: 'FAIL',
        reason: 'missing_item',
        namedField: 'missing:north_wall',
      },
    ]);
    const operation = tranche.beginSettlement(refuse, 'refuse', due);
    expect(operation?.authorizationId).toBe('auth_renewed');
    tranche.confirmSettlement({ effect: 'VOID', authorizationId: 'auth_renewed', reference: 'void' });
    tranche.redispatch();
    expect(() => tranche.dispatch('auth_renewed', new Nonce('N8R'), due, expiry)).toThrow();
    tranche.dispatch('auth_second_visit', new Nonce('N8R'), due, expiry);
    expect(() => tranche.beginReauthorization(due + 1)).toThrow();
    const renewal = tranche.beginReauthorization(due + 3 * day);
    expect(renewal.authorizationId).toBe('auth_second_visit');
    tranche.reauthorizationFailed({ ...renewal, kind: 'REJECTED_NO_REAUTHORIZATION' });
    expect(tranche.expire(expiry).authorizationId).toBe('auth_second_visit');
    expect(tranche.attempts).toHaveLength(2);
  });
  it('preserves the original deadline and unique operation identities over repeated renewals', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), (failures) => {
        const tranche = held();
        const keys = new Set<string>();
        for (const [index, rejected] of failures.entries()) {
          const now = due + index * 3 * day;
          let operation = tranche.beginReauthorization(now);
          expect(keys.has(operation.key)).toBe(false);
          keys.add(operation.key);
          if (rejected) {
            tranche.reauthorizationFailed({ ...operation, kind: 'REJECTED_NO_REAUTHORIZATION' });
            operation = tranche.beginReauthorization(now);
            expect(keys.has(operation.key)).toBe(false);
            keys.add(operation.key);
          }
          tranche.reauthorizationFailed({ ...operation, kind: 'AMBIGUOUS' });
          expect(tranche.pendingReauthorization).toBe(operation);
          tranche.confirmReauthorization({
            ...confirmation(tranche, now, `auth_${index}`),
            previousAuthorizationId: operation.authorizationId,
          });
          expect(tranche.currentHold.expiresAt).toBe(expiry);
          expect(tranche.currentHold.heldAt).toBe(at);
          expect(tranche.currentHold.nonce).toBe('K7Q');
          expect(tranche.attempts).toHaveLength(1);
          expect(tranche.settlements).toEqual([]);
        }
        expect(tranche.expire(expiry).authorizationId).toBe(tranche.currentHold.authorizationId);
      }),
      { numRuns: 500 },
    );
  });
});
