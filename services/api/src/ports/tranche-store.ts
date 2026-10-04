import type { TrancheCommand } from '../domain/tranche-record.js';
import type { StoredOperation } from './payment-operation-store.js';
export type StoredTranche = Readonly<{
  trancheId: string;
  version: number;
  record: string;
  pending: StoredOperation | null;
}>;
export interface TrancheStore {
  load(trancheId: string): Promise<StoredTranche>;
  create(record: string): Promise<StoredTranche>;
  apply(trancheId: string, expectedVersion: number, commandId: string, command: TrancheCommand): Promise<StoredTranche>;
}
export class TrancheStoreError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'STALE_VERSION' | 'IDENTITY_CONFLICT' | 'INVALID_COMMAND' | 'CORRUPT_STATE',
  ) {
    super(code);
  }
}
