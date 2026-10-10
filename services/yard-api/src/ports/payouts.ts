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
export type PayoutSent =
  | Readonly<{ outcome: 'SENT'; payoutBatchId: string }>
  // PayPal refused the batch itself (its debug id): nothing was paid.
  | Readonly<{ outcome: 'REFUSED'; reference: string }>
  // No answer, or one Yard cannot read: try again with the same batch id.
  | Readonly<{ outcome: 'UNKNOWN' }>;
export type PayoutItemStatus = 'PENDING' | 'PAID_OUT' | 'UNCLAIMED' | 'RETURNED' | 'FAILED' | 'UNKNOWN';
export interface PayoutProvider {
  send(request: PayoutRequest): Promise<PayoutSent>;
  status(payoutBatchId: string): Promise<Readonly<{ status: PayoutItemStatus; reference?: string }>>;
}
