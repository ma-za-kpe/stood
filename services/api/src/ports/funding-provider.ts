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
