import { assessmentSentence } from './assessment-sentence.js';
import type { Decision } from './decision.js';
import type { Tranche } from './tranche.js';
export type RecipientSentences = Readonly<{ payer: string; inspector: string }>;

// matchedDate is supplied by a trusted photo index, never inferred from photos.
export function recipientAssessment(decision: Decision, matchedDate?: string): RecipientSentences {
  let payer = assessmentSentence(decision);
  let inspector = 'A reviewer is checking. You do not need to do anything.';
  if (decision.outcome === 'RELEASE') inspector = 'The evidence checks passed.';
  if (decision.outcome === 'WAIT' && decision.reason === 'weak_tests')
    inspector = 'Request stronger signed acceptance tests before resubmitting.';
  if (decision.outcome === 'WAIT' && decision.reason === 'usage_pending')
    inspector = 'Add the agreed independent usage receipt and buyer acceptance.';
  if (decision.outcome === 'REFUSE') {
    switch (decision.namedField) {
      case 'signed_tests_changed':
        inspector = 'Restore the frozen signed tests and submit a new commit.';
        break;
      case 'tests_skipped':
        inspector = 'Run every frozen test without skips or selective execution.';
        break;
      case 'tests_failed':
        inspector = 'Make every frozen test pass on a new commit, then submit again.';
        break;
      // Site-visit scenario instructions.
      case 'plot': {
        const distance = decision.detail?.distance_m;
        if (distance === undefined) inspector = 'Go back to the pin and capture again.';
        else {
          const rounded = Math.round(distance);
          const display = rounded >= 1000 ? `${(rounded / 1000).toFixed(1)} km` : `${rounded} m`;
          inspector = `Photos were taken ${display} from the pin. Go back and capture again.`;
        }
        break;
      }
      case 'reused':
        if (matchedDate) payer = `Old photos. These match the photos from ${matchedDate}.`;
        inspector = 'These photos were sent before. Take new ones on site.';
        break;
      case 'nonce':
        inspector = 'Write the visit code on paper and capture again.';
        break;
      case 'expired':
        inspector = 'Ask the platform for a new visit before capturing again.';
        break;
      default:
        inspector = decision.namedField?.startsWith('missing:')
          ? `Add ${decision.namedField.slice(8).replaceAll('_', ' ')}.`
          : 'Ask the reviewer which evidence to capture again.';
    }
  }
  return Object.freeze({ payer, inspector });
}

export function trancheSentences(tranche: Tranche, now: number): RecipientSentences {
  const last = tranche.decisions.at(-1)?.decision;
  const copy = last
    ? recipientAssessment(last)
    : { payer: 'Your stage is waiting.', inspector: 'Wait for the platform before starting.' };
  const symbols: Readonly<Record<string, string>> = { GBP: '£', USD: '$', EUR: '€' };
  const minor = tranche.amount.minor;
  const amount = `${symbols[tranche.amount.currency]}${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
  let money: string;
  if (tranche.pendingOperation || tranche.pendingReauthorization) money = 'Payment is not confirmed.';
  else if (tranche.settlement)
    money = tranche.settlement.effect === 'CAPTURE' ? `${amount} paid.` : 'Nothing was paid. The hold ended.';
  else if (tranche.attempts.length)
    money =
      now >= tranche.currentHold.expiresAt
        ? 'The hold needs an expiry check. Payment is not confirmed.'
        : `${amount} is held, not paid.`;
  else money = 'Nothing was paid.';
  return Object.freeze({ payer: `${copy.payer} ${money}`, inspector: `${copy.inspector} ${money}` });
}
