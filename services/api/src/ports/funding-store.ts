export type FundingStatus =
  | 'RESERVED'
  | 'CREATING'
  | 'AWAITING_APPROVAL'
  | 'AUTHORIZING'
  | 'HELD'
  | 'FAILED'
  | 'EXPIRED';
export type FundingReservation = Readonly<{
  key: string;
  trancheId: string;
  platformId: string;
  expectedVersion: number;
  nonce: string;
  mode: 'sim' | 'live';
}>;
export type FundingInstruction = FundingReservation &
  Readonly<{
    allowanceId: string;
    payeeRef: string;
    amount: Readonly<{ minor: number; currency: string }>;
  }>;
export type FundingHold = Readonly<{
  orderId: string;
  authorizationId: string;
  heldAt: number;
  expiresAt: number;
  reference: string;
}>;
export type FundingOperation = Readonly<{
  key: string;
  trancheId: string;
  instruction: FundingInstruction;
  version: number;
  status: FundingStatus;
  createRequestId: string;
  authorizeRequestId: string;
  orderId: string | null;
  approvalUrl: string | null;
  hold: (FundingHold & Readonly<{ now?: number }>) | null;
  reference: string | null;
  createdAt: string;
}>;
export interface FundingStore {
  reserve(input: FundingReservation): Promise<FundingOperation>;
  load(key: string): Promise<FundingOperation>;
  beginCreate(key: string, version: number): Promise<FundingOperation>;
  orderCreated(key: string, order: Readonly<{ orderId: string; approvalUrl: string }>): Promise<FundingOperation>;
  beginAuthorize(key: string, version: number): Promise<FundingOperation>;
  confirm(key: string, hold: FundingHold): Promise<FundingOperation>;
  expire(key: string, hold: FundingHold, now: number): Promise<FundingOperation>;
  fail(key: string, reference: string): Promise<FundingOperation>;
}
export class FundingStoreError extends Error {
  constructor(readonly code: 'INVALID' | 'NOT_FOUND' | 'STALE_VERSION' | 'IDENTITY_CONFLICT' | 'CONFLICT') {
    super(code);
  }
}
