// ADR-0027: Yard pays builders out of its own PayPal account (PayPal Payouts). One batch per paid work order.
export type PayoutRequest = Readonly<{
  // Fixed per work order; sent as both sender_batch_id and PayPal-Request-Id, so a resend cannot pay twice.
  batchId: string;
  // A PayPal email or a PayPal merchant id (13 characters).
  payee: string;
  minor: number;
  currency: string;
  // Shown to the builder: the job and work order this pays for.
  note: string;
}>;
// Third audit (2026-10-11), following PayPal's Payouts contract: "PayPal does not process duplicate payouts. If you
// specify a sender_batch_id that was used in the last 30 days, the API rejects the request with an error message that
// shows the duplicate sender_batch_id and includes a HATEOAS link to the original payout", and "If you receive an
// HTTP 5nn status code, you can safely retry the request with the same sender_batch_id."
export type PayoutSent =
  // PayPal accepted the batch now, or earlier (a duplicate whose link names the original batch).
  | Readonly<{ outcome: 'SENT'; payoutBatchId: string }>
  // PayPal validated and refused the request (4xx with its debug id, not about the batch id): nothing was paid.
  | Readonly<{ outcome: 'REFUSED'; reference: string }>
  // PayPal says this batch id was used, but gives no link to the original: only the owner can reconcile it.
  | Readonly<{ outcome: 'REVIEW'; reason: string }>
  // No answer, a 5xx, 401 or 429, or anything else: retry with the same batch id (inside the resend window).
  | Readonly<{ outcome: 'UNKNOWN'; reason: string }>;
// PayPal's item transaction_status, as Yard records it. RETURNED covers RETURNED, REFUNDED and REVERSED (the money is
// back with Yard); REVIEW covers BLOCKED (PayPal does not say where the money is).
export type PayoutItemStatus = 'PENDING' | 'PAID_OUT' | 'UNCLAIMED' | 'RETURNED' | 'FAILED' | 'REVIEW' | 'UNKNOWN';
export interface PayoutProvider {
  send(request: PayoutRequest): Promise<PayoutSent>;
  status(payoutBatchId: string): Promise<Readonly<{ status: PayoutItemStatus; reference?: string }>>;
}
