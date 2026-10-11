import { captureFenced, JUDGE_DECISION } from '../domain/judged-release.js';
import { restoreTrancheRecord } from '../domain/tranche-record.js';

export type ReviewRow = Readonly<{
  trancheId: string;
  profileId: string;
  state: string;
  decisionId: string;
  outcome: string;
  reason: string;
  // True when settlement refuses to capture this tranche (its last decision is not the judge's).
  fenced: boolean;
}>;

// Owner decision 2026-10-10: every code decision recorded before the judge existed is listed for the owner. Releases
// among them are void for payment (settlement refuses them) and are never replayed.
export function releaseReview(streams: readonly Readonly<{ trancheId: string; record: string }>[]): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const stream of streams) {
    const tranche = restoreTrancheRecord(stream.record);
    if (!tranche.profileId.startsWith('code.')) continue;
    for (const d of tranche.decisions) {
      if (d.id.startsWith(JUDGE_DECISION.run) || d.id.startsWith(JUDGE_DECISION.usage)) continue;
      rows.push({
        trancheId: stream.trancheId,
        profileId: tranche.profileId,
        state: tranche.state,
        decisionId: d.id,
        outcome: d.decision.outcome,
        reason: d.decision.reason,
        fenced: captureFenced(tranche, 'CAPTURE'),
      });
    }
  }
  return rows;
}
