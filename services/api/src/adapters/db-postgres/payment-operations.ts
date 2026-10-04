import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  OperationIntent,
  OperationStatus,
  PaymentOperationStore,
  StoredOperation,
} from '../../ports/payment-operation-store.js';
import * as schema from './schema.js';

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Row = typeof schema.paymentOperations.$inferSelect;
const stored = (row: Row): StoredOperation => Object.freeze({ ...row, operation: Object.freeze({ ...row.operation }) });
const validVersion = (version: number) => Number.isInteger(version) && version >= 0 && version < 2147483647;
const { paymentStreams: streams, paymentOperations: operations, paymentOperationEvents: events } = schema;

export class PostgresPaymentOperations implements PaymentOperationStore {
  constructor(private readonly db: Database) {}

  async createStream(trancheId: string): Promise<void> {
    if (!trancheId.trim()) throw new Error('Invalid payment stream');
    await this.db.insert(streams).values({ trancheId }).onConflictDoNothing();
  }
  async reserve(trancheId: string, expectedVersion: number, operation: OperationIntent): Promise<StoredOperation> {
    if (!validVersion(expectedVersion)) throw new Error('Invalid payment version');
    const intent = this.intent(operation);
    return this.db.transaction(async (tx) => {
      const version = await this.lock(tx, trancheId);
      const [existing] = await tx.select().from(operations).where(eq(operations.key, intent.key));
      if (existing) {
        if (
          existing.trancheId !== trancheId ||
          existing.reservedFromVersion !== expectedVersion ||
          JSON.stringify(this.intent(existing.operation)) !== JSON.stringify(intent)
        )
          throw new Error('Operation identity conflict');
        return stored(existing);
      }
      if (version !== expectedVersion) throw new Error('Stale payment version');
      const unresolved = await tx
        .select()
        .from(operations)
        .where(and(eq(operations.trancheId, trancheId), inArray(operations.status, ['RESERVED', 'AMBIGUOUS'])));
      if (unresolved.length) throw new Error('Unresolved payment operation');
      const [row] = await tx
        .insert(operations)
        .values({
          trancheId,
          key: intent.key,
          operation: intent,
          providerRequestId: randomUUID(),
          status: 'RESERVED',
          reservedFromVersion: expectedVersion,
          version: version + 1,
        })
        .returning();
      if (!row) throw new Error('Payment reservation was not written');
      await this.append(tx, row);
      return stored(row);
    });
  }
  async load(trancheId: string, key: string): Promise<StoredOperation | null> {
    const [row] = await this.db
      .select()
      .from(operations)
      .where(and(eq(operations.trancheId, trancheId), eq(operations.key, key)));
    return row ? stored(row) : null;
  }
  async recordOutcome(
    trancheId: string,
    expectedVersion: number,
    key: string,
    status: Exclude<OperationStatus, 'RESERVED'>,
    reference: string | null,
  ): Promise<StoredOperation> {
    const validStatus = ['AMBIGUOUS', 'CONFIRMED', 'FAILED'].includes(status);
    if (!validVersion(expectedVersion) || !validStatus || (status !== 'AMBIGUOUS' && !reference?.trim()))
      throw new Error('Invalid payment outcome');
    return this.db.transaction(async (tx) => {
      const version = await this.lock(tx, trancheId);
      const [existing] = await tx
        .select()
        .from(operations)
        .where(and(eq(operations.trancheId, trancheId), eq(operations.key, key)));
      if (!existing) throw new Error('Unknown payment operation');
      if (existing.status === status && existing.reference === reference) return stored(existing);
      if (existing.status === 'CONFIRMED' || existing.status === 'FAILED')
        throw new Error('Operation already resolved');
      if (version !== expectedVersion) throw new Error('Stale payment version');
      const [row] = await tx
        .update(operations)
        .set({ status, reference, version: version + 1 })
        .where(eq(operations.key, key))
        .returning();
      if (!row) throw new Error('Payment outcome was not written');
      await this.append(tx, row);
      return stored(row);
    });
  }
  async history(trancheId: string) {
    const rows = await this.db
      .select()
      .from(events)
      .where(eq(events.trancheId, trancheId))
      .orderBy(asc(events.version));
    return Object.freeze(rows.map((row) => Object.freeze(row)));
  }
  private async lock(tx: Transaction, trancheId: string): Promise<number> {
    const [stream] = await tx.select().from(streams).where(eq(streams.trancheId, trancheId)).for('update');
    if (!stream) throw new Error('Unknown payment stream');
    return stream.version;
  }
  private async append(tx: Transaction, row: Row): Promise<void> {
    await tx.update(streams).set({ version: row.version }).where(eq(streams.trancheId, row.trancheId));
    await tx.insert(events).values({
      trancheId: row.trancheId,
      key: row.key,
      version: row.version,
      status: row.status,
      reference: row.reference,
    });
  }
  private intent(operation: OperationIntent): OperationIntent {
    if (!operation.key.trim() || !operation.authorizationId.trim()) throw new Error('Invalid payment intent');
    const { key, effect, authorizationId } = operation;
    if (effect === 'REAUTHORIZE') {
      const { requestedAt, previousState } = operation;
      if (!Number.isSafeInteger(requestedAt) || !['HELD', 'DECIDING', 'WAITING'].includes(previousState))
        throw new Error('Invalid renewal intent');
      return { key, effect, authorizationId, requestedAt, previousState };
    }
    if (
      (effect !== 'CAPTURE' && effect !== 'VOID') ||
      !['RELEASED', 'REFUSED', 'EXPIRED', 'CANCELLED'].includes(operation.target) ||
      (effect === 'CAPTURE' && operation.target !== 'RELEASED')
    )
      throw new Error('Invalid settlement intent');
    return { key, effect, authorizationId, target: operation.target };
  }
}
