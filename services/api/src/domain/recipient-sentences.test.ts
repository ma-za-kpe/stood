import { describe, expect, it } from 'vitest';
import { type Decision, RULE_SET_VERSION } from './decision.js';
import { Money } from './money.js';
import { Nonce } from './nonce.js';
import { recipientAssessment, trancheSentences } from './recipient-sentences.js';
import { Tranche } from './tranche.js';

const at = 1790985600000;
const expiry = at + 29 * 86400000;
const decision: Decision = {
  outcome: 'RELEASE',
  effect: 'CAPTURE',
  reason: 'fixture',
  namedField: null,
  detail: null,
  profileId: 'construction.stage@1',
  ruleSetVersion: RULE_SET_VERSION,
};
const held = (profile = 'construction.stage@1') => {
  const tranche = new Tranche('copy', new Money(1000n, 'GBP'), profile, 1);
  tranche.dispatch('auth', new Nonce('K7Q'), at, expiry);
  return tranche;
};
describe('Copy for payer and inspector', () => {
  it('formats large amounts without floating point and does not claim an overdue hold is still active', () => {
    const tranche = new Tranche('large', new Money(9007199254740990n, 'EUR'), 'construction.stage@1', 0);
    tranche.dispatch('auth', new Nonce('K7Q'), at, expiry);
    expect(trancheSentences(tranche, at).payer).toContain('€90071992547409.90');
    expect(trancheSentences(tranche, expiry).payer).toContain('Payment is not confirmed.');
  });
  it('names the missing item and separates the instructions from the payer reason', () => {
    const copy = recipientAssessment({
      ...decision,
      outcome: 'REFUSE',
      effect: 'VOID',
      namedField: 'missing:north_wall',
    });
    expect(copy.payer).toContain('north wall');
    expect(copy.inspector).toBe('Add north wall.');
    expect(copy.payer).not.toBe(copy.inspector);
  });
  it.each(['plot', 'reused', 'nonce', 'expired', 'unknown', null])(
    'tells the inspector what to redo for %s',
    (namedField) => {
      expect(
        recipientAssessment({ ...decision, outcome: 'REFUSE', effect: 'VOID', namedField }).inspector.length,
      ).toBeGreaterThan(0);
    },
  );
  it('uses a supplied indexed match date, and rounded distance, without inventing either', () => {
    expect(recipientAssessment({ ...decision, outcome: 'REFUSE', namedField: 'reused' }, '12 March').payer).toContain(
      '12 March',
    );
    expect(
      recipientAssessment({ ...decision, outcome: 'REFUSE', namedField: 'plot', detail: { distance_m: 999.6 } })
        .inspector,
    ).toContain('1.0 km');
    expect(
      recipientAssessment({ ...decision, outcome: 'REFUSE', namedField: 'plot', detail: { distance_m: 750 } })
        .inspector,
    ).toContain('750 m');
    expect(recipientAssessment({ ...decision, outcome: 'WAIT', effect: 'NONE' }).inspector).toContain('reviewer');
    // Code milestones name what to fix: a changed, skipped or failed frozen test.
    for (const [namedField, instruction] of [
      ['signed_tests_changed', 'Restore the frozen signed tests and submit a new commit.'],
      ['tests_skipped', 'Run every frozen test without skips or selective execution.'],
      ['tests_failed', 'Make every frozen test pass on a new commit, then submit again.'],
    ] as const)
      expect(recipientAssessment({ ...decision, outcome: 'REFUSE', effect: 'VOID', namedField }).inspector).toBe(
        instruction,
      );
  });
  it('never claims a pending capture or cancellation paid or returned money', () => {
    const tranche = held();
    tranche.startDeciding();
    tranche.beginSettlement(decision, 'assessment', at);
    expect(trancheSentences(tranche, at).payer).toContain('Payment is not confirmed.');
    expect(trancheSentences(tranche, at).payer).not.toContain('£10.00 paid');
    const rental = held('rental.return@1');
    rental.startDeciding();
    rental.beginSettlement({ ...decision, profileId: 'rental.return@1', effect: 'VOID' }, 'return', at);
    expect(trancheSentences(rental, at).payer).toContain('Payment is not confirmed.');
  });
  it('states the matching money effect only after confirmation, including deposit inversion', () => {
    const tranche = held();
    tranche.startDeciding();
    tranche.beginSettlement(decision, 'assessment', at);
    tranche.confirmSettlement({ effect: 'CAPTURE', authorizationId: 'auth', reference: 'capture' });
    expect(trancheSentences(tranche, at).payer).toContain('£10.00 paid.');
    expect(trancheSentences(tranche, at).inspector).toContain('£10.00 paid.');
    const rental = held('rental.return@1');
    rental.startDeciding();
    rental.beginSettlement({ ...decision, profileId: 'rental.return@1', effect: 'VOID' }, 'return', at);
    rental.confirmSettlement({ effect: 'VOID', authorizationId: 'auth', reference: 'cancel' });
    expect(trancheSentences(rental, at).payer).toContain('Nothing was paid. The hold ended.');
  });
  it('describes unfunded, held and renewal states honestly', () => {
    const unfunded = new Tranche('new', new Money(1000n, 'USD'), 'construction.stage@1', 0);
    expect(trancheSentences(unfunded, at).payer).toContain('Nothing was paid.');
    const tranche = held();
    expect(trancheSentences(tranche, at).payer).toContain('£10.00 is held, not paid.');
    tranche.beginReauthorization(at + 3 * 86400000);
    expect(trancheSentences(tranche, at).payer).toContain('Payment is not confirmed.');
  });
});
