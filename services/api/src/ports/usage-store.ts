import type { UsageReceipt } from '../domain/usage-receipt.js';

// C4 (#77): verified usage receipts. A final milestone releases only on use confirmed by an authority outside the
// builder's tree; Stood stores a receipt only after it verified, and each nonce once.
export type StoredUsage = Readonly<{ trancheId: string; commit: string; nonce: string; acceptedAt: string }>;
export interface UsageStore {
  // The latest package's commit and allowance for a tranche this platform owns, or null.
  target(platformId: string, trancheId: string): Promise<Readonly<{ allowanceId: string; commit: string }> | null>;
  // The receipt stored under this nonce, so a retry of the same receipt is answered from it.
  byNonce(nonce: string): Promise<Readonly<{ usage: StoredUsage; receipt: UsageReceipt }> | null>;
  record(platformId: string, receipt: UsageReceipt): Promise<StoredUsage>;
  // A verified receipt for this tranche and commit, if any.
  find(trancheId: string, commit: string): Promise<StoredUsage | null>;
}
export class UsageStoreError extends Error {
  constructor(readonly code: 'REPLAYED') {
    super(code);
  }
}
