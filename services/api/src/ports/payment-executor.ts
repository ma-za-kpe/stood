import type { TrancheCommand } from '../domain/tranche-record.js';
import type { StoredTranche } from './tranche-store.js';
export type PaymentResult = Extract<
  TrancheCommand,
  { method: 'confirmSettlement' | 'settlementFailed' | 'confirmReauthorization' | 'reauthorizationFailed' }
>;
export interface PaymentExecutor {
  execute(snapshot: StoredTranche): Promise<PaymentResult | null>;
}
