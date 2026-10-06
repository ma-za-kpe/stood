import type { StoredDraft } from './platform-api-store.js';
import type { VaultAttempt } from './vault-provider.js';
export type Mandate = VaultAttempt &
  Readonly<{ version: number; acceptedAt: number; expiresAt: number; createdAt: string }>;
export type MandateReservation = Readonly<{
  key: string;
  platformId: string;
  allowanceId: string;
  termsVersion: number;
  termsHash: string;
  mode: 'sim' | 'live';
  acceptedAt: number;
}>;
export type SetupReceipt = Readonly<{ setupId: string; customerId: string; approvalUrl: string | null }>;
export type TokenReceipt = Readonly<{ setupId: string; customerId: string; payerId: string; tokenId: string }>;
export interface MandateStore {
  reserve(input: MandateReservation): Promise<Mandate>;
  load(key: string): Promise<Mandate>;
  beginCreate(key: string, version: number): Promise<Mandate>;
  setupCreated(key: string, receipt: SetupReceipt): Promise<Mandate>;
  beginTokenize(key: string, version: number, payerId: string): Promise<Mandate>;
  confirm(key: string, receipt: TokenReceipt): Promise<Mandate>;
  revoke(platformId: string, key: string): Promise<Mandate>;
}
export interface MandateTerms {
  load(platformId: string, allowanceId: string): Promise<StoredDraft | null>;
}
export class MandateStoreError extends Error {
  constructor(readonly code: 'INVALID' | 'NOT_FOUND' | 'STALE_VERSION' | 'IDENTITY_CONFLICT' | 'CONFLICT') {
    super(code);
  }
}
