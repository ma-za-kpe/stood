// Audit 2026-10-10, finding 6: a run that decides nothing says why, so an operator can tell a GitHub outage from a
// sandbox that would not start or an evidence bucket that refused a write. The reason names a step, never an error
// message, so nothing from a provider or the code under test reaches the log.
export type Waiting = `WAIT:${string}`;
export type Step = 'GITHUB' | 'RUNNER' | 'SIGNATURE' | 'EVIDENCE' | 'STORE';

export function waitingOn(step: Step, error?: unknown): Waiting {
  const stage = (error as { stage?: unknown } | undefined)?.stage;
  if (step === 'RUNNER' && typeof stage === 'string' && /^[A-Z]+$/.test(stage))
    return `WAIT:RUNNER_UNAVAILABLE:${stage}`;
  return `WAIT:${step}_UNAVAILABLE`;
}
