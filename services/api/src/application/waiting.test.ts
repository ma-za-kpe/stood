import { expect, it } from 'vitest';
import { waitingOn } from './waiting.js';

// Audit 2026-10-10, finding 6: every wait names the step it stopped at, and a runner failure its stage.
it('names the step, and the runner stage when the runner reports one, never an error message', () => {
  expect(waitingOn('GITHUB', new Error('REPOSITORY_UNAVAILABLE'))).toBe('WAIT:GITHUB_UNAVAILABLE');
  expect(waitingOn('RUNNER', Object.assign(new Error('x'), { stage: 'INSTALL' }))).toBe(
    'WAIT:RUNNER_UNAVAILABLE:INSTALL',
  );
  expect(waitingOn('RUNNER', { stage: 'token=abc' })).toBe('WAIT:RUNNER_UNAVAILABLE');
  expect(waitingOn('EVIDENCE', { stage: 'INSTALL' })).toBe('WAIT:EVIDENCE_UNAVAILABLE');
  expect(waitingOn('SIGNATURE')).toBe('WAIT:SIGNATURE_UNAVAILABLE');
});
