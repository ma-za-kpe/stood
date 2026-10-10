import { describe, expect, it } from 'vitest';
import { claimedFixture, leaseAt, leaseBuilder, leaseBuyer } from '../../test/fakes/board-fixture.js';
import type { PayoutProvider, PayoutRequest } from '../ports/payouts.js';
import { type Board, HOLDBACK_MS } from './board.js';
import { runPayouts } from './payouts.js';

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
  let answer: 'SENT' | 'UNKNOWN' | 'REFUSED' = 'SENT';
  let item: 'PENDING' | 'PAID_OUT' | 'UNCLAIMED' | 'RETURNED' = 'PENDING';
  const provider: PayoutProvider = {
    send: async (request) => {
      sent.push(request);
      if (answer === 'UNKNOWN') return { outcome: 'UNKNOWN' };
      if (answer === 'REFUSED') return { outcome: 'REFUSED', reference: 'debug-1' };
      return { outcome: 'SENT', payoutBatchId: `PB-${request.batchId.slice(5, 13)}` };
    },
    status: async () => ({ status: item, ...(item === 'PAID_OUT' ? { reference: 'TXN-1' } : {}) }),
  };
  return {
    provider,
    sent,
    answer: (a: typeof answer) => {
      answer = a;
    },
    item: (s: typeof item) => {
      item = s;
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
    expect(await run(board, paypal.provider, leaseAt + 10 * HOLDBACK_MS)).toEqual({
      reserved: 0,
      sent: 0,
      settled: 0,
      waiting: 0,
      noPayee: 0,
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
});
