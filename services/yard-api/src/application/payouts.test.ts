import { describe, expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import type { PayoutProvider, PayoutRequest } from '../ports/payouts.js';
import { type Board, HOLDBACK_MS } from './board.js';
import { RESEND_WINDOW_MS, runPayouts } from './payouts.js';

// A work order paid by Stood at `at` (the fixture's first milestone is code.milestone@1, so it has a review window).
async function paid(at = leaseAt) {
  const { board, id } = await claimedFixture();
  const v = async () => (await board.events.load(id)).version;
  await board.submit(id, 'one', 'd'.repeat(40), 'pkg-1', leaseBuilder, await v(), 'submit', at);
  await board.settlement(
    id,
    'one',
    {
      eventId: 'paid',
      trancheId: 'tranche',
      packageId: 'pkg-1',
      reference: 'capture-1',
      effect: 'CAPTURE',
      minor: 1000,
      currency: 'USD',
      simulated: true,
    },
    await v(),
    at,
  );
  return { board, id, v };
}
function fakePayPal() {
  const sent: PayoutRequest[] = [];
  let answer: 'SENT' | 'UNKNOWN' | 'REFUSED' | 'REVIEW' | 'DUPLICATE' = 'SENT';
  let item: 'PENDING' | 'PAID_OUT' | 'UNCLAIMED' | 'RETURNED' | 'FAILED' | 'REVIEW' = 'PENDING';
  const provider: PayoutProvider = {
    send: async (request) => {
      sent.push(request);
      if (answer === 'UNKNOWN') return { outcome: 'UNKNOWN', reason: 'no_answer' };
      if (answer === 'REFUSED') return { outcome: 'REFUSED', reference: 'debug-1' };
      if (answer === 'REVIEW') return { outcome: 'REVIEW', reason: 'duplicate_without_link' };
      // A duplicate answers with the original batch: the same as SENT for Yard.
      return { outcome: 'SENT', payoutBatchId: `PB${request.batchId.slice(5, 13).toUpperCase()}` };
    },
    status: async () => ({ status: item, ...(item === 'PAID_OUT' ? { reference: 'TXN-1' } : {}) }),
  };
  return {
    provider,
    sent,
    answer: (a: typeof answer) => {
      answer = a;
    },
    item: (i: typeof item) => {
      item = i;
    },
  };
}
const run = (board: Board, provider: PayoutProvider, now: number, payee = 'builder@example.com') =>
  runPayouts({ board, provider, payeeOf: (b) => (b === leaseBuilder.id ? payee : undefined), clock: () => now });

// ADR-0027: platform receipt, then payout.
describe('builder payouts', () => {
  it('pays the builder after the 48-hour review window, once, and reconciles the payout to paid out', async () => {
    const { board, id } = await paid();
    const paypal = fakePayPal();
    expect(await run(board, paypal.provider, leaseAt + HOLDBACK_MS - 1)).toMatchObject({ reserved: 0, sent: 0 });
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({
      state: 'HELD_BACK',
      payoutDueAt: leaseAt + HOLDBACK_MS,
    });
    // A lost answer: reserved, sent, no reply. The resend carries the same batch id.
    paypal.answer('UNKNOWN');
    expect(await run(board, paypal.provider, leaseAt + HOLDBACK_MS)).toMatchObject({
      reserved: 1,
      sent: 0,
      waiting: 1,
    });
    paypal.answer('SENT');
    expect(await run(board, paypal.provider, leaseAt + HOLDBACK_MS + 60_000)).toMatchObject({ reserved: 0, sent: 1 });
    expect(paypal.sent).toHaveLength(2);
    expect(new Set(paypal.sent.map((r) => r.batchId)).size).toBe(1);
    expect(paypal.sent[0]).toMatchObject({ payee: 'builder@example.com', minor: 1000, currency: 'USD' });
    expect(await run(board, paypal.provider, leaseAt + HOLDBACK_MS + 120_000)).toMatchObject({
      waiting: 1,
      settled: 0,
    });
    paypal.item('PAID_OUT');
    expect(await run(board, paypal.provider, leaseAt + HOLDBACK_MS + 180_000)).toMatchObject({ settled: 1 });
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({
      state: 'PAID_OUT',
      builderMinor: 1000,
      capturedMinor: 1000,
      payoutReference: 'TXN-1',
    });
    expect(await run(board, paypal.provider, leaseAt + 10 * HOLDBACK_MS)).toMatchObject({
      reserved: 0,
      sent: 0,
      settled: 0,
      waiting: 0,
      noPayee: 0,
      issues: [],
    });
    expect(paypal.sent).toHaveLength(2);
  });

  it('holds the money while the buyer disputes inside the window, and only then', async () => {
    const { board, id, v } = await paid();
    const paypal = fakePayPal();
    await expect(
      board.dispute(id, 'one', leaseBuilder, await v(), 'd1', leaseAt + 1, 'not mine to dispute'),
    ).rejects.toThrow('FORBIDDEN');
    await board.dispute(id, 'one', leaseBuyer, await v(), 'd1', leaseAt + 1000, 'The booking page does not load.');
    expect(await run(board, paypal.provider, leaseAt + 5 * HOLDBACK_MS)).toMatchObject({ reserved: 0 });
    expect(paypal.sent).toEqual([]);
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'DISPUTED', disputedAt: leaseAt + 1000 });
    const late = await paid();
    await expect(
      late.board.dispute(late.id, 'one', leaseBuyer, await late.v(), 'd2', leaseAt + HOLDBACK_MS, 'too late'),
    ).rejects.toThrow('CONFLICT');
  });

  it('sends nothing to a builder with no PayPal payee on record, and records a refused batch as failed', async () => {
    const { board, id } = await paid();
    const paypal = fakePayPal();
    expect(
      await runPayouts({
        board,
        provider: paypal.provider,
        payeeOf: () => undefined,
        clock: () => leaseAt + HOLDBACK_MS,
      }),
    ).toMatchObject({ noPayee: 1, reserved: 0 });
    expect(paypal.sent).toEqual([]);
    paypal.answer('REFUSED');
    await run(board, paypal.provider, leaseAt + HOLDBACK_MS);
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'FAILED', payoutReference: 'debug-1' });
    await expect(board.ledger(id, leaseBuilder)).rejects.toThrow('FORBIDDEN');
  });

  // Third audit (2026-10-11): PayPal refuses a reused batch id for 30 days, so Yard resends for at most 7 days.
  it('stops resending an unanswered payout after the resend window and asks the owner to reconcile it', async () => {
    const { board, id, v } = await paid();
    const paypal = fakePayPal();
    paypal.answer('UNKNOWN');
    const due = leaseAt + HOLDBACK_MS;
    expect((await run(board, paypal.provider, due)).issues).toEqual([
      { projectId: id, wo: 'one', code: 'PAYOUT_UNANSWERED', reason: 'no_answer' },
    ]);
    await run(board, paypal.provider, due + RESEND_WINDOW_MS);
    const sentBefore = paypal.sent.length;
    expect((await run(board, paypal.provider, due + RESEND_WINDOW_MS + 1)).issues[0]).toMatchObject({
      code: 'PAYOUT_REVIEW',
    });
    await run(board, paypal.provider, due + 30 * 86_400_000);
    expect(paypal.sent.length).toBe(sentBefore);
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'REVIEW' });
    // The owner finds it in PayPal and records it; or finds nothing, and it can be retried or refunded.
    // Fourth audit: settling it paid needs PayPal's payout batch id, so it stays monitored for refunds and reversals.
    await expect(
      board.payoutAction(id, 'one', await v(), 'settle-bad', due + 31 * 86_400_000, {
        type: 'SETTLE_REVIEW',
        outcome: 'PAID_OUT',
        reference: 'TXN-FOUND',
        note: 'Found in the PayPal activity log',
      }),
    ).rejects.toThrow('INVALID');
    await board.payoutAction(id, 'one', await v(), 'settle', due + 31 * 86_400_000, {
      type: 'SETTLE_REVIEW',
      outcome: 'PAID_OUT',
      payoutBatchId: 'PBFOUND123',
      reference: 'TXN-FOUND',
      note: 'Found in the PayPal activity log',
    });
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'PAID_OUT', payoutReference: 'TXN-FOUND' });
    expect((await board.payoutsOpen(due + 32 * 86_400_000)).map((o) => o.payout.payoutBatchId)).toEqual(['PBFOUND123']);
  });

  it('records refunds and reversals after a payout, and lets the owner retry under a new batch id or refund', async () => {
    const { board, id, v } = await paid();
    const paypal = fakePayPal();
    const due = leaseAt + HOLDBACK_MS;
    await run(board, paypal.provider, due);
    paypal.item('PAID_OUT');
    await run(board, paypal.provider, due + 1);
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'PAID_OUT' });
    // The builder refunds the payout to Yard later: read again (at most daily) and recorded.
    paypal.item('RETURNED');
    const checked = new Map<string, number>();
    const again = (at: number) =>
      runPayouts({ board, provider: paypal.provider, payeeOf: () => 'builder@example.com', clock: () => at, checked });
    expect((await again(due + 2 * 86_400_000)).issues[0]).toMatchObject({ code: 'PAYOUT_RETURNED' });
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'RETURNED' });
    // The owner pays the builder again at a corrected address: a new attempt, a new batch id.
    await board.payoutAction(id, 'one', await v(), 'retry', due + 3 * 86_400_000, {
      type: 'RETRY_PAYOUT',
      payee: 'builder-new@example.com',
      note: 'Builder asked to be paid at a new address',
    });
    paypal.item('PENDING');
    await again(due + 4 * 86_400_000);
    expect(paypal.sent.at(-1)).toMatchObject({ payee: 'builder-new@example.com' });
    expect(new Set(paypal.sent.map((r) => r.batchId)).size).toBe(2);
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'SENT', payoutAttempts: 2 });
    // An unclaimed payout can still fail.
    paypal.item('UNCLAIMED');
    await again(due + 5 * 86_400_000);
    paypal.item('FAILED');
    await again(due + 6 * 86_400_000);
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'FAILED' });
    // Or the owner refunds the buyer instead, and records the refund.
    await board.payoutAction(id, 'one', await v(), 'refund', due + 7 * 86_400_000, {
      type: 'REFUND_BUYER',
      note: 'Builder unreachable',
    });
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'REFUND_DUE' });
    await board.payoutAction(id, 'one', await v(), 'refunded', due + 8 * 86_400_000, {
      type: 'REFUNDED',
      reference: 'REFUND-1',
      note: 'Refunded in PayPal',
    });
    expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'REFUNDED', refundReference: 'REFUND-1' });
  });

  it('closes a dispute either way: the builder is paid at once, or the buyer is refunded', async () => {
    for (const outcome of ['PAY_BUILDER', 'REFUND_BUYER'] as const) {
      const { board, id, v } = await paid();
      const paypal = fakePayPal();
      await board.dispute(id, 'one', leaseBuyer, await v(), 'd', leaseAt + 1, 'The booking page does not load.');
      expect(await board.payoutAttention()).toEqual([
        {
          projectId: id,
          wo: 'one',
          state: 'DISPUTED',
          builderMinor: 1000,
          currency: 'USD',
          reason: 'The booking page does not load.',
        },
      ]);
      await board.payoutAction(id, 'one', await v(), 'resolve', leaseAt + 2, {
        type: 'RESOLVE_DISPUTE',
        outcome,
        note: 'Reviewed the evidence',
      });
      await run(board, paypal.provider, leaseAt + 3);
      if (outcome === 'PAY_BUILDER') {
        expect(paypal.sent).toHaveLength(1);
        expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'SENT' });
      } else {
        expect(paypal.sent).toEqual([]);
        expect((await board.ledger(id, leaseBuyer))[0]).toMatchObject({ state: 'REFUND_DUE' });
      }
      await expect(
        board.payoutAction(id, 'one', await v(), 'again', leaseAt + 4, {
          type: 'RESOLVE_DISPUTE',
          outcome,
          note: 'again',
        }),
      ).rejects.toThrow('CONFLICT');
    }
  });

  // Fourth audit (2026-10-11): an unreadable status is reported, and does not count as the day's check.
  it('reports a paid-out payout PayPal would not show, and reads it again on the next run', async () => {
    const { board } = await paid();
    const paypal = fakePayPal();
    const due = leaseAt + HOLDBACK_MS;
    await run(board, paypal.provider, due);
    paypal.item('PAID_OUT');
    await run(board, paypal.provider, due + 1);
    const checked = new Map<string, number>();
    let reads = 0;
    const flaky: PayoutProvider = {
      ...paypal.provider,
      status: async () => {
        reads++;
        return { status: 'UNKNOWN' };
      },
    };
    const tick = (at: number, provider: PayoutProvider) =>
      runPayouts({ board, provider, payeeOf: () => 'builder@example.com', clock: () => at, checked });
    expect((await tick(due + 2 * 86_400_000, flaky)).issues[0]).toMatchObject({ code: 'PAYOUT_CHECK_FAILED' });
    await tick(due + 2 * 86_400_000 + 60_000, flaky);
    expect(reads).toBe(2);
    expect((await tick(due + 2 * 86_400_000 + 120_000, paypal.provider)).issues).toEqual([]);
    expect((await tick(due + 2 * 86_400_000 + 180_000, flaky)).issues).toEqual([]);
    expect(reads).toBe(2);
  });
});
