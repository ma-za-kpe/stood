import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { type Decision, RULE_SET_VERSION } from './decision.js';
import {
  advanceTrancheRecord,
  createTrancheRecord,
  restoreTrancheRecord,
  type TrancheCommand,
} from './tranche-record.js';

const day = 86400000;
const at = Date.parse('2026-10-03T00:00:00Z');
const expiry = at + 29 * day;
const definition = {
  id: 'trn_recovery',
  amount: { minor: 400000, currency: 'GBP' },
  profileId: 'construction.stage@1',
  maxResubmits: 1,
};
const decision = (outcome: Decision['outcome']): Decision => ({
  outcome,
  effect: outcome === 'RELEASE' ? 'CAPTURE' : outcome === 'REFUSE' ? 'VOID' : 'NONE',
  profileId: definition.profileId,
  ruleSetVersion: RULE_SET_VERSION,
  namedField: 'plot',
  reason: 'fixture',
  detail: { distance_m: 1400 },
});
const command = (method: TrancheCommand['method'], args: unknown[] = []): TrancheCommand =>
  ({ method, args }) as unknown as TrancheCommand;
const advance = (record: string, method: TrancheCommand['method'], args: unknown[] = []) =>
  advanceTrancheRecord(record, command(method, args));
const held = () => advance(createTrancheRecord(definition), 'dispatch', ['auth_1', 'K7Q', at, expiry]);
const deciding = () => advance(held(), 'startDeciding');
const pending = () => advance(deciding(), 'beginSettlement', [decision('RELEASE'), 'decision_1', at]);

describe('Tranche recovery record', () => {
  it('recovers definition and funding state without sharing mutable input', () => {
    const input = { ...definition, amount: { ...definition.amount } };
    const record = createTrancheRecord(input);
    input.amount.minor = 1;
    expect(restoreTrancheRecord(record).amount.minor).toBe(400000n);
    expect(restoreTrancheRecord(record).state).toBe('PENDING');
    expect(restoreTrancheRecord(advance(record, 'fundingFailed')).state).toBe('WAIT_FUNDING');
  });
  it('recovers pending captures, ambiguity and definite-failure retry counters', () => {
    let record = pending();
    const first = restoreTrancheRecord(record).pendingOperation;
    expect(first?.key).toBe('trn_recovery:1:CAPTURE:1');
    record = advance(record, 'settlementFailed', [{ kind: 'AMBIGUOUS', effect: 'CAPTURE', authorizationId: 'auth_1' }]);
    expect(restoreTrancheRecord(record).pendingOperation).toEqual(first);
    record = advance(record, 'settlementFailed', [{ kind: 'DECLINED', effect: 'CAPTURE', authorizationId: 'auth_1' }]);
    expect(restoreTrancheRecord(record).state).toBe('WAITING');
    record = advance(record, 'beginSettlement', [decision('RELEASE'), 'decision_2', at]);
    expect(restoreTrancheRecord(record).pendingOperation?.key).not.toBe(first?.key);
    record = advance(record, 'confirmSettlement', [
      { effect: 'CAPTURE', authorizationId: 'auth_1', reference: 'capture_fixture' },
    ]);
    const released = restoreTrancheRecord(record);
    expect(released.state).toBe('RELEASED');
    expect(released.decisions).toHaveLength(2);
    expect(released.settlement).toMatchObject({ effect: 'CAPTURE', reference: 'capture_fixture', attempt: 1 });
    expect(restoreTrancheRecord(advance(record, 'dispute')).settlement).toEqual(released.settlement);
  });
  it('recovers refusal, redispatch bounds and expiry without losing prior history', () => {
    let record = advance(deciding(), 'beginSettlement', [decision('REFUSE'), 'refusal_1', at]);
    record = advance(record, 'confirmSettlement', [{ effect: 'VOID', authorizationId: 'auth_1', reference: 'void_1' }]);
    record = advance(record, 'redispatch');
    expect(() => advance(record, 'dispatch', ['auth_1', 'K7Q', at, expiry])).toThrow();
    record = advance(record, 'dispatch', ['auth_2', 'M8R', at, expiry]);
    const second = advance(advance(record, 'startDeciding'), 'beginSettlement', [decision('REFUSE'), 'refusal_2', at]);
    const refused = advance(second, 'confirmSettlement', [
      { effect: 'VOID', authorizationId: 'auth_2', reference: 'void_2' },
    ]);
    expect(() => advance(refused, 'redispatch')).toThrow('Resubmission limit reached');
    record = advance(record, 'expire', [expiry]);
    expect(restoreTrancheRecord(record).pendingOperation).toMatchObject({
      effect: 'VOID',
      target: 'EXPIRED',
      authorizationId: 'auth_2',
    });
    record = advance(record, 'confirmSettlement', [
      { effect: 'VOID', authorizationId: 'auth_2', reference: 'expired_void' },
    ]);
    const expired = restoreTrancheRecord(record);
    expect(expired.state).toBe('EXPIRED');
    expect(expired.attempts.map((attempt) => attempt.authorizationId)).toEqual(['auth_1', 'auth_2']);
    expect(expired.settlements.map((settlement) => settlement.reference)).toEqual(['void_1', 'expired_void']);
  });
  it('recovers renewal retry identity, original deadline, nonce and renewed authorisation clock', () => {
    let record = advance(held(), 'beginReauthorization', [at + 3 * day]);
    const first = restoreTrancheRecord(record).pendingReauthorization;
    expect(first).not.toBeNull();
    record = advance(record, 'reauthorizationFailed', [{ ...first, kind: 'AMBIGUOUS' }]);
    expect(restoreTrancheRecord(record).pendingReauthorization).toEqual(first);
    record = advance(record, 'reauthorizationFailed', [{ ...first, kind: 'REJECTED_NO_REAUTHORIZATION' }]);
    record = advance(record, 'beginReauthorization', [at + 3 * day]);
    const retry = restoreTrancheRecord(record).pendingReauthorization;
    expect(retry?.key).not.toBe(first?.key);
    expect(retry?.key).toBe('trn_recovery:1:REAUTHORIZE:1:2');
    record = advance(record, 'confirmReauthorization', [
      {
        ...retry,
        previousAuthorizationId: 'auth_1',
        authorizationId: 'auth_renewed',
        confirmedAt: at + 3 * day,
        expiresAt: expiry,
      },
    ]);
    const restored = restoreTrancheRecord(record);
    expect(restored.currentHold).toMatchObject({
      authorizationId: 'auth_renewed',
      nonce: 'K7Q',
      heldAt: at,
      expiresAt: expiry,
    });
    expect(restored.attempts[0]?.authorizationId).toBe('auth_1');
    expect(restored.reauthorizations).toHaveLength(1);
    expect(() => advance(record, 'beginReauthorization', [at + 3 * day + 1])).toThrow();
    record = advance(advance(record, 'startDeciding'), 'beginSettlement', [
      decision('RELEASE'),
      'renewed_decision',
      at + 3 * day,
    ]);
    expect(restoreTrancheRecord(record).pendingOperation?.authorizationId).toBe('auth_renewed');
  });
  it('keeps prior records and recorded decisions immutable after failed or changed caller inputs', () => {
    const prior = deciding();
    const assessment = decision('WAIT');
    const record = advance(prior, 'beginSettlement', [assessment, 'wait_1', at]);
    (assessment.detail as { distance_m: number }).distance_m = 0;
    expect(restoreTrancheRecord(record).decisions[0]?.decision.detail?.distance_m).toBe(1400);
    expect(restoreTrancheRecord(prior).state).toBe('DECIDING');
    expect(() =>
      advance(record, 'confirmSettlement', [{ effect: 'CAPTURE', authorizationId: 'auth_1', reference: 'unreserved' }]),
    ).toThrow();
    expect(restoreTrancheRecord(record).state).toBe('WAITING');
    const margin = advance(prior, 'beginSettlement', [decision('RELEASE'), 'margin', expiry - 1]);
    expect(restoreTrancheRecord(margin).settlementBlock).toBe('CAPTURE_WINDOW_CLOSING');
  });
  it('fails closed on malformed, incompatible or illegal records', () => {
    const valid = JSON.parse(createTrancheRecord(definition));
    for (const value of [
      null,
      {},
      { ...valid, schemaVersion: 2 },
      { ...valid, ruleSetVersion: 'future' },
      { ...valid, commands: null },
      { ...valid, definition: null },
      { ...valid, definition: { ...definition, amount: { minor: 1.5, currency: 'GBP' } } },
      { ...valid, commands: [{ method: 'unknown', args: [] }] },
      { ...valid, commands: [{ method: 'dispatch', args: null }] },
      { ...valid, commands: [{ method: 'fundingFailed', args: [1] }] },
      { ...valid, commands: [null] },
    ])
      expect(() => restoreTrancheRecord(JSON.stringify(value))).toThrow();
    expect(() => restoreTrancheRecord('broken JSON')).toThrow();
    expect(() => advance(createTrancheRecord(definition), 'dispute')).toThrow();
    expect(() => advance(held(), 'expire', [Number.NaN])).toThrow();
  });
  it('preserves settlement retry identity through arbitrary ambiguous and definite failures', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('AMBIGUOUS', 'DECLINED'), { maxLength: 20 }), (failures) => {
        let record = pending();
        let attempt = 1;
        for (const kind of failures) {
          record = advance(record, 'settlementFailed', [{ kind, effect: 'CAPTURE', authorizationId: 'auth_1' }]);
          if (kind === 'DECLINED') {
            attempt++;
            record = advance(record, 'beginSettlement', [decision('RELEASE'), `decision_${attempt}`, at]);
          }
          const recovered = restoreTrancheRecord(record);
          expect(recovered.state).toBe('CAPTURE_PENDING');
          expect(recovered.pendingOperation?.key).toBe(`trn_recovery:1:CAPTURE:${attempt}`);
          expect(recovered.decisions).toHaveLength(attempt);
        }
      }),
      { numRuns: 100 },
    );
  });
});
