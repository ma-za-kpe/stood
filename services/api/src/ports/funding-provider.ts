import type { FundingInstruction, FundingOperation } from './funding-store.js';

// Approval is a signed, versioned mandate lookup, not a client-supplied boolean.
// Runtime financial routes must install a qualified implementation.
export interface FundingAuthority {
  canFund(instruction: FundingInstruction, now: number): Promise<boolean>;
}
export interface FundingProvider {
  create(operation: FundingOperation): Promise<unknown>;
  authorize(operation: FundingOperation): Promise<unknown>;
  read(operation: FundingOperation, candidateOrderId?: string): Promise<unknown>;
}
// T-0154: the saved PayPal payment token for a signed mandate, looked up only at call time, never stored with funding.
export interface SavedPaymentTokens {
  tokenFor(instruction: FundingInstruction): Promise<string | null>;
}
