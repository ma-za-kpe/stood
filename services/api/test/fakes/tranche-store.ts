import { advanceTrancheRecord, restoreTrancheRecord, type TrancheCommand } from '../../src/domain/tranche-record.js';
import {
  type LatestPackageGuard,
  type StoredTranche,
  type TrancheStore,
  TrancheStoreError,
} from '../../src/ports/tranche-store.js';
// Application test provider. Real locking, audit and restart evidence uses Postgres.
export class MemoryTranches implements TrancheStore, LatestPackageGuard {
  private values = new Map<string, StoredTranche>();
  // The latest package submitted per tranche; a tranche with none here accepts any package.
  readonly latestPackage = new Map<string, string>();
  async applyIfLatest(id: string, expectedVersion: number, commandId: string, command: TrancheCommand, pkg: string) {
    const latest = this.latestPackage.get(id);
    if (latest !== undefined && latest !== pkg) throw new TrancheStoreError('STALE_PACKAGE');
    return this.apply(id, expectedVersion, commandId, command);
  }
  async create(record: string) {
    const t = restoreTrancheRecord(record);
    const value = { trancheId: t.id, version: 0, record, pending: null };
    this.values.set(t.id, value);
    return structuredClone(value);
  }
  async load(id: string): Promise<StoredTranche> {
    const value = this.values.get(id);
    if (!value) throw new TrancheStoreError('NOT_FOUND');
    return structuredClone(value);
  }
  async apply(id: string, expectedVersion: number, _commandId: string, command: TrancheCommand) {
    const previous = await this.load(id);
    if (previous.version !== expectedVersion) throw new TrancheStoreError('STALE_VERSION');
    const record = advanceTrancheRecord(previous.record, command);
    const t = restoreTrancheRecord(record),
      operation = t.pendingOperation ?? t.pendingReauthorization;
    // Compare again immediately before the synchronous write, so competing test
    // workers cannot both win after the await above.
    if (this.values.get(id)?.version !== expectedVersion) throw new TrancheStoreError('STALE_VERSION');
    const version = previous.version + 1;
    const value: StoredTranche = {
      trancheId: id,
      version,
      record,
      pending: operation
        ? {
            trancheId: id,
            operation,
            providerRequestId: previous.pending?.providerRequestId ?? `${id}-provider-request`,
            status: previous.pending ? 'AMBIGUOUS' : 'RESERVED',
            reference: null,
            version,
            reservedFromVersion: previous.pending?.reservedFromVersion ?? expectedVersion,
            createdAt: previous.pending?.createdAt ?? new Date(t.currentHold.heldAt).toISOString(),
          }
        : null,
    };
    this.values.set(id, value);
    return structuredClone(value);
  }
}
