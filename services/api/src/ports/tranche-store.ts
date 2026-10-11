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
// Audit 2026-10-10, finding 5: a decision on a code package applies only while that package is still the tranche's
// latest, checked under the same lock a new submission takes, so a run that finishes after a newer package arrived
// cannot settle money on stale work.
export interface LatestPackageGuard {
  applyIfLatest(
    trancheId: string,
    expectedVersion: number,
    commandId: string,
    command: TrancheCommand,
    packageId: string,
  ): Promise<StoredTranche>;
}
export class TrancheStoreError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'STALE_VERSION'
      | 'IDENTITY_CONFLICT'
      | 'INVALID_COMMAND'
      | 'CORRUPT_STATE'
      | 'STALE_PACKAGE',
  ) {
    super(code);
  }
}
