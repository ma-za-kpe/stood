import type { ProviderCapture, ProviderTransactions } from '../../ports/provider-transactions.js';

const status: Record<string, ProviderCapture['status']> = {
  S: 'COMPLETED',
  P: 'PENDING',
  D: 'DECLINED',
  V: 'REFUNDED',
};
// Transaction Search over HTTP. The simulator speaks the same shape; live use waits for sandbox keys (T-0224).
export class HttpTransactionSearch implements ProviderTransactions {
  constructor(
    private readonly config: Readonly<{
      baseUrl: string;
      token(): Promise<string>;
      transport?: (request: Request) => Promise<Response>;
    }>,
  ) {}
  async captures(fromMs: number, toMs: number): Promise<readonly ProviderCapture[]> {
    const url = new URL('/v1/reporting/transactions', this.config.baseUrl);
    url.searchParams.set('start_date', new Date(fromMs).toISOString());
    url.searchParams.set('end_date', new Date(toMs).toISOString());
    const response = await (this.config.transport ?? fetch)(
      new Request(url, {
        headers: { Authorization: `Bearer ${await this.config.token()}` },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      }),
    );
    if (!response.ok) throw new Error('Transaction search unavailable');
    const body = (await response.json()) as { transaction_details?: { transaction_info?: Record<string, unknown> }[] };
    return (body.transaction_details ?? []).map((d) => {
      const t = d.transaction_info ?? {};
      const amount = t.transaction_amount as { currency_code?: string; value?: string } | undefined;
      if (typeof t.transaction_id !== 'string' || !amount?.value || !/^\d+\.\d{2}$/.test(amount.value))
        throw new Error('Unexpected transaction shape');
      return {
        id: t.transaction_id,
        invoiceId: typeof t.invoice_id === 'string' ? t.invoice_id : null,
        minor: Number(amount.value.replace('.', '')),
        currency: String(amount.currency_code),
        status: status[String(t.transaction_status)] ?? 'PENDING',
      };
    });
  }
}
