import { expect, it } from 'vitest';
import { decide, getProfile } from '../domain/decision.js';
import { advanceTrancheRecord, createTrancheRecord, type TrancheCommand } from '../domain/tranche-record.js';
import { releaseReview } from './release-review.js';

const at = 1790985600000;
function stream(trancheId: string, profileId: string, decisionId: string) {
  const passing = getProfile(profileId).checks.map(({ code, source }) => ({
    code,
    source,
    status: 'PASS' as const,
    reason: 'fixture',
    ...(source === 'MODEL' ? { confidence: 1 } : {}),
  }));
  let record = createTrancheRecord({
    id: trancheId,
    amount: { minor: 1000, currency: 'USD' },
    profileId,
    maxResubmits: 1,
  });
  for (const command of [
    { method: 'dispatch', args: ['auth', 'K7Q', at, at + 28 * 86400000] },
    { method: 'startDeciding', args: [] },
    { method: 'beginSettlement', args: [decide(profileId, passing as never), decisionId, at + 1] },
  ] as TrancheCommand[])
    record = advanceTrancheRecord(record, command);
  return { trancheId, record };
}

// Owner decision 2026-10-10: the owner sees every code decision the old runner recorded, each fenced from payment.
it('lists only the old runner decisions on code milestones, each refused by settlement', () => {
  const rows = releaseReview([
    stream('trn_old', 'code.milestone@1', 'run:pkg_1'),
    stream('trn_new', 'code.milestone@1', 'judge:pkg_2'),
    stream('trn_site', 'construction.stage@1', 'decision'),
  ]);
  expect(rows).toEqual([
    {
      trancheId: 'trn_old',
      profileId: 'code.milestone@1',
      state: 'CAPTURE_PENDING',
      decisionId: 'run:pkg_1',
      outcome: 'RELEASE',
      reason: 'all_checks_passed',
      fenced: true,
    },
  ]);
});
