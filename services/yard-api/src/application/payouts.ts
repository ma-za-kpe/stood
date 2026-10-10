import type { PayoutProvider } from '../ports/payouts.js';
import type { Board } from './board.js';

// ADR-0027: once a minute, pays builders whose milestones are due and reconciles payouts in flight.
// 1. Due: released, past the 48-hour review window (none for the final milestone), not disputed. The payout is
//    reserved in Yard's ledger before PayPal is called.
// 2. Reserved: sent to PayPal Payouts with its fixed batch id; a lost answer is resent with the same id.
// 3. Sent or unclaimed: PayPal's item status is read until it is paid out, returned or failed.
// A builder with no PayPal payee on record is skipped and reported; nothing is sent without one.
export async function runPayouts(
  deps: Readonly<{
    board: Board;
    provider: PayoutProvider;
    payeeOf: (builderId: string) => string | undefined;
    clock: () => number;
  }>,
): Promise<Readonly<{ reserved: number; sent: number; settled: number; waiting: number; noPayee: number }>> {
  const result = { reserved: 0, sent: 0, settled: 0, waiting: 0, noPayee: 0 };
  const version = async (id: string) => (await deps.board.events.load(id)).version;
  for (const due of await deps.board.payoutsDue(deps.clock())) {
    const payee = deps.payeeOf(due.builderId);
    if (!payee) {
      result.noPayee++;
      continue;
    }
    try {
      await deps.board.reservePayout(due.projectId, due.wo, await version(due.projectId), payee, deps.clock());
      result.reserved++;
    } catch {
      result.waiting++;
    }
  }
  for (const { projectId, wo, payout } of await deps.board.payoutsOpen()) {
    try {
      if (payout.status === 'RESERVED') {
        const sent = await deps.provider.send({
          batchId: payout.batchId,
          payee: payout.payee,
          minor: payout.builderMinor,
          currency: payout.currency,
          note: `Yard work order ${wo} (job ${projectId}), released by Stood`,
        });
        if (sent.outcome === 'UNKNOWN') {
          result.waiting++;
          continue;
        }
        await deps.board.payoutUpdate(
          projectId,
          wo,
          await version(projectId),
          sent.outcome === 'SENT'
            ? { status: 'SENT', payoutBatchId: sent.payoutBatchId }
            : { status: 'FAILED', reference: sent.reference },
        );
        result.sent += sent.outcome === 'SENT' ? 1 : 0;
        continue;
      }
      const read = await deps.provider.status(payout.payoutBatchId ?? '');
      if (read.status === 'PENDING' || read.status === 'UNKNOWN' || read.status === payout.status) {
        result.waiting++;
        continue;
      }
      await deps.board.payoutUpdate(projectId, wo, await version(projectId), {
        status: read.status,
        ...(read.reference ? { reference: read.reference } : {}),
      });
      result.settled++;
    } catch {
      result.waiting++;
    }
  }
  return result;
}
