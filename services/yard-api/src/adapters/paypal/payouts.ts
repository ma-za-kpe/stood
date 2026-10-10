import type { PayoutItemStatus, PayoutProvider, PayoutRequest, PayoutSent } from '../../ports/payouts.js';

type Config = Readonly<{
  // Yard's own PayPal REST app (ADR-0027), never Stood's. Sandbox until PayPal approves Payouts for real money.
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
}>;
const decimals = (currency: string) => (['JPY', 'HUF', 'TWD'].includes(currency) ? 0 : 2);
const object = (v: unknown) =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const ITEM: Record<string, PayoutItemStatus> = {
  SUCCESS: 'PAID_OUT',
  UNCLAIMED: 'UNCLAIMED',
  RETURNED: 'RETURNED',
  FAILED: 'FAILED',
  BLOCKED: 'FAILED',
  REFUNDED: 'RETURNED',
  REVERSED: 'RETURNED',
  PENDING: 'PENDING',
  ONHOLD: 'PENDING',
  NEW: 'PENDING',
};

// ADR-0027: PayPal Payouts from Yard's own account. One batch, one item, per paid work order. The batch id is also
// PayPal-Request-Id, so a resend after a lost answer returns the first result instead of paying again.
export class PayPalPayouts implements PayoutProvider {
  private readonly http: typeof globalThis.fetch;
  private token: { value: string; until: number } | null = null;
  constructor(private readonly config: Config) {
    if (!config.clientId.trim() || !config.clientSecret.trim() || !/^https:\/\//.test(config.baseUrl))
      throw new Error('PAYPAL_PAYOUTS_INVALID');
    this.http = config.fetch ?? fetch;
  }
  private async bearer(): Promise<string> {
    if (this.token && Date.now() < this.token.until) return this.token.value;
    const response = await this.http(`${this.config.baseUrl}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(20_000),
    });
    const body = object(await response.json().catch(() => null));
    if (!response.ok || typeof body?.access_token !== 'string') throw new Error('PAYPAL_UNAVAILABLE');
    const seconds = typeof body.expires_in === 'number' ? body.expires_in : 300;
    this.token = { value: body.access_token, until: Date.now() + Math.max(0, seconds - 120) * 1000 };
    return body.access_token;
  }
  async send(request: PayoutRequest): Promise<PayoutSent> {
    if (!/^yard-[a-f0-9]{40}$/.test(request.batchId) || !Number.isSafeInteger(request.minor) || request.minor < 1)
      throw new Error('INVALID_PAYOUT');
    const email = request.payee.includes('@');
    let response: Response;
    try {
      response = await this.http(`${this.config.baseUrl}/v1/payments/payouts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await this.bearer()}`,
          'Content-Type': 'application/json',
          'PayPal-Request-Id': request.batchId,
        },
        body: JSON.stringify({
          sender_batch_header: {
            sender_batch_id: request.batchId,
            email_subject: 'You have been paid for your Yard work',
          },
          items: [
            {
              recipient_type: email ? 'EMAIL' : 'PAYPAL_ID',
              receiver: request.payee,
              amount: {
                value: (request.minor / 10 ** decimals(request.currency)).toFixed(decimals(request.currency)),
                currency: request.currency,
              },
              sender_item_id: request.batchId,
              note: request.note.slice(0, 4000),
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return { outcome: 'UNKNOWN' };
    }
    const body = object(await response.json().catch(() => null));
    const id = object(body?.batch_header)?.payout_batch_id;
    if (response.status === 201 && typeof id === 'string' && id) return { outcome: 'SENT', payoutBatchId: id };
    // PayPal refused the batch (a 4xx with its debug id, not a conflict): nothing was paid.
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 409 &&
      typeof body?.debug_id === 'string'
    )
      return { outcome: 'REFUSED', reference: body.debug_id };
    return { outcome: 'UNKNOWN' };
  }
  async status(payoutBatchId: string) {
    if (!/^[A-Z0-9]{8,40}$/.test(payoutBatchId)) return { status: 'UNKNOWN' as const };
    try {
      const response = await this.http(`${this.config.baseUrl}/v1/payments/payouts/${payoutBatchId}`, {
        headers: { Authorization: `Bearer ${await this.bearer()}` },
        signal: AbortSignal.timeout(20_000),
      });
      const item = object((object(await response.json())?.items as unknown[] | undefined)?.[0]);
      const status = ITEM[String(item?.transaction_status)] ?? 'UNKNOWN';
      const reference = typeof item?.transaction_id === 'string' ? item.transaction_id : undefined;
      return response.ok ? { status, ...(reference ? { reference } : {}) } : { status: 'UNKNOWN' as const };
    } catch {
      return { status: 'UNKNOWN' as const };
    }
  }
}
