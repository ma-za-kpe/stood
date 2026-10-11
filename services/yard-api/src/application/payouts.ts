import type { PayoutProvider } from '../ports/payouts.js';
import type { Board } from './board.js';

// Third audit (2026-10-11): PayPal refuses a reused sender_batch_id for 30 days. A reservation is resent with its own
// batch id for at most 7 days; after that Yard stops resending and the owner reconciles it (REVIEW).
export const RESEND_WINDOW_MS = 7 * 86_400_000;
// A paid-out payout is read again at most once a day, for 180 days, to catch PayPal refunds and reversals.
const RECHECK_MS = 86_400_000;
export type PayoutIssue = Readonly<{ projectId: string; wo: string; code: string; reason: string }>;
export type PayoutRun = Readonly<{
  reserved: number;
  sent: number;
  settled: number;
  waiting: number;
  noPayee: number;
  issues: readonly PayoutIssue[];
}>;

// ADR-0027: once a minute, pays builders whose milestones are due and reconciles payouts in flight.
// 1. Due: released, past the 48-hour review window (none for the final milestone), dispute settled for the builder
//    if there was one. The payout is reserved in the job's ledger before PayPal is called.
// 2. Reserved: sent with its batch id; a lost answer is resent with the same id inside the resend window.
// 3. Sent, unclaimed or recently paid out: PayPal's item status is read, and every move it reports is recorded.
// Every problem is returned with its project, work order and reason, for the log.
export async function runPayouts(
  deps: Readonly<{
    board: Board;
    provider: PayoutProvider;
    payeeOf: (builderId: string) => string | undefined;
    clock: () => number;
    // When each paid-out batch was last read (kept by the caller across runs).
    checked?: Map<string, number>;
  }>,
): Promise<PayoutRun> {
  const result = { reserved: 0, sent: 0, settled: 0, waiting: 0, noPayee: 0 };
  const issues: PayoutIssue[] = [];
  const checked = deps.checked ?? new Map<string, number>();
  const now = deps.clock();
  const version = async (id: string) => (await deps.board.events.load(id)).version;
  const issue = (projectId: string, wo: string, code: string, reason: string) => {
    issues.push({ projectId, wo, code, reason: reason.slice(0, 200) });
  };
  for (const due of await deps.board.payoutsDue(now)) {
    const payee = deps.payeeOf(due.builderId);
    if (!payee) {
      result.noPayee++;
      issue(due.projectId, due.wo, 'PAYOUT_NO_PAYEE', `builder ${due.builderId} has no payeeRef`);
      continue;
    }
    try {
      await deps.board.reservePayout(due.projectId, due.wo, await version(due.projectId), payee, now);
      result.reserved++;
    } catch (error) {
      result.waiting++;
      issue(due.projectId, due.wo, 'PAYOUT_RESERVE_FAILED', error instanceof Error ? error.message : 'unknown');
    }
  }
  for (const { projectId, wo, payout } of await deps.board.payoutsOpen(now)) {
    const update = async (u: Parameters<Board['payoutUpdate']>[4]) =>
      deps.board.payoutUpdate(projectId, wo, await version(projectId), payout.batchId, u, now);
    try {
      if (payout.status === 'RESERVED') {
        if (now - payout.reservedAt > RESEND_WINDOW_MS) {
          await update({ status: 'REVIEW', reason: 'no_answer_within_resend_window' });
          issue(projectId, wo, 'PAYOUT_REVIEW', 'no answer from PayPal within the resend window');
          continue;
        }
        const sent = await deps.provider.send({
          batchId: payout.batchId,
          payee: payout.payee,
          minor: payout.builderMinor,
          currency: payout.currency,
          note: `Yard work order ${wo} (job ${projectId}), released by Stood`,
        });
        if (sent.outcome === 'UNKNOWN') {
          result.waiting++;
          issue(projectId, wo, 'PAYOUT_UNANSWERED', sent.reason);
        } else if (sent.outcome === 'SENT') {
          await update({ status: 'SENT', payoutBatchId: sent.payoutBatchId });
          result.sent++;
        } else if (sent.outcome === 'REVIEW') {
          await update({ status: 'REVIEW', reason: sent.reason });
          issue(projectId, wo, 'PAYOUT_REVIEW', sent.reason);
        } else {
          await update({ status: 'FAILED', reference: sent.reference, reason: 'refused_by_paypal' });
          issue(projectId, wo, 'PAYOUT_FAILED', `PayPal refused it (${sent.reference})`);
        }
        continue;
      }
      if (payout.status === 'PAID_OUT') {
        if (now - (checked.get(payout.batchId) ?? 0) < RECHECK_MS) continue;
        checked.set(payout.batchId, now);
      }
      const read = await deps.provider.status(payout.payoutBatchId ?? '');
      if (read.status === 'PENDING' || read.status === 'UNKNOWN' || read.status === payout.status) {
        if (payout.status !== 'PAID_OUT') result.waiting++;
        continue;
      }
      await update({ status: read.status, ...(read.reference ? { reference: read.reference } : {}) });
      result.settled++;
      if (read.status !== 'PAID_OUT')
        issue(
          projectId,
          wo,
          `PAYOUT_${read.status}`,
          `PayPal reports ${read.status.toLowerCase()} after ${payout.status.toLowerCase()}`,
        );
    } catch (error) {
      result.waiting++;
      issue(projectId, wo, 'PAYOUT_STEP_FAILED', error instanceof Error ? error.message : 'unknown');
    }
  }
  return { ...result, issues };
}
