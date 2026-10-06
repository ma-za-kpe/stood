export type VaultAttempt = Readonly<{
  key: string;
  platformId: string;
  allowanceId: string;
  termsVersion: number;
  termsHash: string;
  customerRef: string;
  mode: 'sim' | 'live';
  status: 'RESERVED' | 'CREATING' | 'AWAITING_APPROVAL' | 'TOKENIZING' | 'SIGNED' | 'REVOKED';
  setupRequestId: string;
  tokenRequestId: string;
  setupId: string | null;
  customerId: string | null;
  payerId: string | null;
  tokenId: string | null;
  approvalUrl: string | null;
}>;
export interface VaultProvider {
  createSetup(attempt: VaultAttempt): Promise<unknown>;
  readSetup(attempt: VaultAttempt, candidateSetupId?: string): Promise<unknown>;
  createToken(attempt: VaultAttempt): Promise<unknown>;
  readToken(attempt: VaultAttempt, candidateTokenId?: string): Promise<unknown>;
}
