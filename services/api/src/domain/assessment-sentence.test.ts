import { describe, expect, it } from 'vitest';
import { assessmentSentence } from './assessment-sentence.js';
import { type Decision, RULE_SET_VERSION } from './decision.js';

const refusal = (namedField: string | null, distance?: number): Decision => ({
  outcome: 'REFUSE',
  effect: 'VOID',
  profileId: 'construction.stage@1',
  ruleSetVersion: RULE_SET_VERSION,
  namedField,
  reason: 'fixture_failed',
  detail: distance === undefined ? null : { distance_m: distance },
});
describe('Assessment sentences describe evidence before payment (T-0127)', () => {
  it('formats pin distance in metres or kilometres', () => {
    expect(assessmentSentence(refusal('plot', 1400))).toBe('Wrong plot. 1.4 km off.');
    expect(assessmentSentence(refusal('plot', 750.4))).toBe('Wrong plot. 750 m off.');
    expect(assessmentSentence(refusal('plot', 999.6))).toBe('Wrong plot. 1.0 km off.');
    expect(assessmentSentence(refusal('plot'))).toBe('Wrong plot.');
  });
  it.each([
    ['reused', 'Old photos. These match a prior package.'],
    ['missing:screen_contact', 'Missing evidence. Add screen contact.'],
    ['nonce', 'The visit code does not match.'],
    ['expired', 'The evidence arrived after the capture window.'],
    ['unknown', 'The evidence does not meet the requirements.'],
    [null, 'The evidence does not meet the requirements.'],
  ])('describes %s without claiming a payment', (field, sentence) => {
    expect(assessmentSentence(refusal(field))).toBe(sentence);
  });
  it('distinguishes a passing assessment from payment confirmation', () => {
    expect(assessmentSentence({ ...refusal(null), outcome: 'RELEASE', effect: 'CAPTURE' })).toBe(
      'Evidence checks passed.',
    );
    expect(assessmentSentence({ ...refusal(null), outcome: 'WAIT', effect: 'NONE' })).toBe(
      'A person needs to check this evidence.',
    );
  });
});
