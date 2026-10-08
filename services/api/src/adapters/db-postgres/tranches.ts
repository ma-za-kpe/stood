import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { advanceTrancheRecord, restoreTrancheRecord, type TrancheCommand } from '../../domain/tranche-record.js';
import type { OperationIntent, OperationStatus, StoredOperation } from '../../ports/payment-operation-store.js';
import { type StoredTranche, type TrancheStore, TrancheStoreError } from '../../ports/tranche-store.js';
import * as schema from './schema.js';

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
const {
  paymentStreams: streams,
  paymentOperations: operations,
  paymentOperationEvents: events,
  trancheCommands: commands,
} = schema;
const pending = (record: string): OperationIntent | null => {
  const tranche = restoreTrancheRecord(record);
  return tranche.pendingOperation ?? tranche.pendingReauthorization;
};
const stored = (row: typeof operations.$inferSelect): StoredOperation =>
  Object.freeze({ ...row, operation: Object.freeze({ ...row.operation }) });
export class PostgresTranches implements TrancheStore {
  constructor(private readonly db: Database) {}
  async create(record: string): Promise<StoredTranche> {
    const tranche = restoreTrancheRecord(record);
    if (pending(record)) throw new TrancheStoreError('INVALID_COMMAND');
    return this.db.transaction(async (tx) => {
      await tx.insert(streams).values({ trancheId: tranche.id, record, initialRecord: record }).onConflictDoNothing();
      const [match] = await tx
        .select({ same: sql<boolean>`${streams.initialRecord}::jsonb = ${record}::jsonb` })
        .from(streams)
        .where(eq(streams.trancheId, tranche.id))
        .for('update');
      if (!match?.same) throw new TrancheStoreError('IDENTITY_CONFLICT');
      return this.snapshot(tx, tranche.id);
    });
  }
  async load(trancheId: string): Promise<StoredTranche> {
    return this.db.transaction(async (tx) => {
      await tx.select().from(streams).where(eq(streams.trancheId, trancheId)).for('share');
      return this.snapshot(tx, trancheId);
    });
  }
  async apply(
    trancheId: string,
    expectedVersion: number,
    commandId: string,
    command: TrancheCommand,
  ): Promise<StoredTranche> {
    return this.db.transaction((tx) => this.applyInTransaction(tx, trancheId, expectedVersion, commandId, command));
  }
  async applyInTransaction(
    tx: Transaction,
    trancheId: string,
    expectedVersion: number,
    commandId: string,
    command: TrancheCommand,
    fundingKey?: string,
  ): Promise<StoredTranche> {
    if (!commandId.trim() || !Number.isInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= 2147483647)
      throw new TrancheStoreError('INVALID_COMMAND');
    const copy = JSON.parse(JSON.stringify(command)) as TrancheCommand;
    const [stream] = await tx.select().from(streams).where(eq(streams.trancheId, trancheId)).for('update');
    if (!stream?.record) throw new TrancheStoreError('NOT_FOUND');
    const [prior] = await tx
      .select({ version: commands.version, same: sql<boolean>`${commands.command} = ${JSON.stringify(copy)}::jsonb` })
      .from(commands)
      .where(and(eq(commands.trancheId, trancheId), eq(commands.commandId, commandId)));
    if (prior) {
      if (!prior.same || prior.version !== expectedVersion + 1) throw new TrancheStoreError('IDENTITY_CONFLICT');
      return this.snapshot(tx, trancheId);
    }
    if (stream.version !== expectedVersion) throw new TrancheStoreError('STALE_VERSION');
    const [funding] = await tx
      .select()
      .from(schema.fundingOperations)
      .where(
        and(
          eq(schema.fundingOperations.trancheId, trancheId),
          inArray(schema.fundingOperations.status, ['RESERVED', 'CREATING', 'AWAITING_APPROVAL', 'AUTHORIZING']),
        ),
      );
    // T-0154: a saved PayPal account's funding resolves straight from CREATING.
    const resolvable =
      funding?.status === 'AUTHORIZING' ||
      (funding?.status === 'CREATING' && funding.instruction.source === 'SAVED_PAYPAL');
    if (funding && (funding.key !== fundingKey || !resolvable || copy.method !== 'confirmFunding'))
      throw new TrancheStoreError('IDENTITY_CONFLICT');
    await this.snapshot(tx, trancheId);
    const record = advanceTrancheRecord(stream.record, copy);
    const version = stream.version + 1;
    await tx.update(streams).set({ record, version }).where(eq(streams.trancheId, trancheId));
    await tx.insert(commands).values({ trancheId, commandId, command: copy, record, version });
    const before = pending(stream.record);
    const after = pending(record);
    if (!before && after) {
      const [operation] = await tx
        .insert(operations)
        .values({
          trancheId,
          key: after.key,
          operation: after,
          providerRequestId: randomUUID(),
          status: 'RESERVED',
          reference: null,
          reservedFromVersion: stream.version,
          version,
        })
        .returning();
      if (!operation) throw new TrancheStoreError('CORRUPT_STATE');
      await this.event(tx, operation);
    } else if (before) {
      const isFailure =
        copy.method === 'settlementFailed' ||
        copy.method === 'reauthorizationFailed' ||
        copy.method === 'confirmNoRenewalExpiry';
      const status: OperationStatus = after ? 'AMBIGUOUS' : isFailure ? 'FAILED' : 'CONFIRMED';
      const args = copy.args[0] as { reference?: string; authorizationId?: string };
      const reference = after
        ? null
        : (args.reference ?? (copy.method === 'confirmReauthorization' ? args.authorizationId : null));
      if (!after && !reference?.trim()) throw new TrancheStoreError('INVALID_COMMAND');
      const [operation] = await tx
        .update(operations)
        .set({ status, reference, version })
        .where(
          and(
            eq(operations.trancheId, trancheId),
            eq(operations.key, before.key),
            inArray(operations.status, ['RESERVED', 'AMBIGUOUS']),
          ),
        )
        .returning();
      if (!operation) throw new TrancheStoreError('CORRUPT_STATE');
      await this.event(tx, operation);
    }
    return this.snapshot(tx, trancheId);
  }
  private async event(tx: Transaction, operation: typeof operations.$inferSelect): Promise<void> {
    await tx.insert(events).values({
      trancheId: operation.trancheId,
      key: operation.key,
      version: operation.version,
      status: operation.status,
      reference: operation.reference,
    });
  }
  private async snapshot(tx: Transaction, trancheId: string): Promise<StoredTranche> {
    const [stream] = await tx.select().from(streams).where(eq(streams.trancheId, trancheId));
    if (!stream?.record) throw new TrancheStoreError('NOT_FOUND');
    const [operation] = await tx
      .select()
      .from(operations)
      .where(and(eq(operations.trancheId, trancheId), inArray(operations.status, ['RESERVED', 'AMBIGUOUS'])));
    const intent = pending(stream.record);
    if ((intent?.key ?? null) !== (operation?.key ?? null)) throw new TrancheStoreError('CORRUPT_STATE');
    if (operation && intent) {
      const [match] = await tx
        .select({ same: sql<boolean>`${operations.operation} = ${JSON.stringify(intent)}::jsonb` })
        .from(operations)
        .where(eq(operations.key, intent.key));
      if (!match?.same) throw new TrancheStoreError('CORRUPT_STATE');
    }
    return Object.freeze({
      trancheId,
      version: stream.version,
      record: stream.record,
      pending: operation ? stored(operation) : null,
    });
  }
}
