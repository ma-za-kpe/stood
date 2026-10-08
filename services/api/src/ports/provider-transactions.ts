// Provider-side captures over a window (PayPal Transaction Search in live mode).
export type ProviderCapture = Readonly<{
  id: string;
  invoiceId: string | null;
  minor: number;
  currency: string;
  status: 'COMPLETED' | 'PENDING' | 'DECLINED' | 'REFUNDED';
  // When PayPal started the transaction (epoch ms), if it says.
  at?: number | null;
}>;
export interface ProviderTransactions {
  captures(fromMs: number, toMs: number): Promise<readonly ProviderCapture[]>;
}
