// Owner decision 2026-10-10 (ADR-0026 amendment): same-process tests are not evidence. A code milestone's money is
// captured only on a decision the out-of-process runner (the judge) recorded. Every decision from the earlier
// in-process runner (ids run:<package> and usage:<package>) is void for payment: it is never captured or replayed.
export const JUDGE_DECISION = { run: 'judge:', usage: 'judge-usage:' } as const;

export function captureFenced(
  tranche: Readonly<{ profileId: string; decisions: readonly Readonly<{ id: string }>[] }>,
  effect: string,
): boolean {
  if (effect !== 'CAPTURE' || !tranche.profileId.startsWith('code.')) return false;
  const last = tranche.decisions.at(-1)?.id ?? '';
  return !(last.startsWith(JUDGE_DECISION.run) || last.startsWith(JUDGE_DECISION.usage));
}
