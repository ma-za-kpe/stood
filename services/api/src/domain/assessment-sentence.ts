import type { Decision } from './decision.js';

// Assessment copy cannot claim a capture/void has completed.
export function assessmentSentence(decision: Decision): string {
  if (decision.outcome === 'RELEASE') return 'Evidence checks passed.';
  if (decision.outcome === 'WAIT') return 'A person needs to check this evidence.';
  switch (decision.namedField) {
    case 'plot': {
      const distance = decision.detail?.distance_m;
      if (distance === undefined) return 'Wrong plot.';
      const rounded = Math.round(distance);
      const display = rounded >= 1000 ? `${(rounded / 1000).toFixed(1)} km` : `${rounded} m`;
      return `Wrong plot. ${display} off.`;
    }
    case 'reused':
      return 'Old photos. These match a prior package.';
    case 'nonce':
      return 'The visit code does not match.';
    case 'expired':
      return 'The evidence arrived after the capture window.';
    default:
      return decision.namedField?.startsWith('missing:')
        ? `Missing evidence. Add ${decision.namedField.slice(8).replaceAll('_', ' ')}.`
        : 'The evidence does not meet the requirements.';
  }
}
