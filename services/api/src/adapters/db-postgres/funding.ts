import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Nonce } from '../../domain/nonce.js';
import { restoreTrancheRecord } from '../../domain/tranche-record.js';
import {
  type FundingHold,
  type FundingOperation,
  type FundingReservation,
  type FundingStore,
  FundingStoreError,
} from '../../ports/funding-store.js';
import * as schema from './schema.js';
import { PostgresTranches } from './tranches.js';

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
type Row = typeof schema.fundingOperations.$inferSelect;
const unresolved = ['RESERVED', 'CREATING', 'AWAITING_APPROVAL', 'AUTHORIZING'] as const;
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 200;
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object')
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, value]) => [k, canonical(value)]),
    );
  return v;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const snapshot = (row: Row): FundingOperation => structuredClone(row);
const savedAccount = (row: Row) => row.instruction.source === 'SAVED_PAYPAL';
function approvalChecked(value: string, mode: FundingReservation['mode'], orderId: string): void {
  try {
    const url = new URL(value);
    if (
      value.length > 4096 ||
      url.username ||
      url.password ||
      url.hash ||
      (mode === 'sim'
        ? url.origin !== 'http://paypal-sim:8080' || url.pathname !== `/__sim/approve/${orderId}` || !!url.search
        : url.origin !== 'https://www.sandbox.paypal.com' ||
          url.pathname !== '/checkoutnow' ||
          url.searchParams.get('token') !== orderId)
    )
      throw new Error();
  } catch {
    throw new FundingStoreError('INVALID');
  }
}
export class PostgresFunding implements FundingStore {
  constructor(private readonly db: Database) {}
  async reserve(value: FundingReservation): Promise<FundingOperation> {
    const input = structuredClone(value);
    if (
      !input ||
      Object.keys(input).some(
        (k) => !['key', 'trancheId', 'platformId', 'expectedVersion', 'nonce', 'mode'].includes(k),
      ) ||
      ![input.key, input.trancheId, input.platformId].every(text) ||
      !Number.isSafeInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      !['sim', 'live'].includes(input.mode)
    )
      throw new FundingStoreError('INVALID');
    try {
      new Nonce(input.nonce);
    } catch {
      throw new FundingStoreError('INVALID');
    }
    return this.db.transaction(async (tx) => {
      const [stream] = await tx
        .select()
        .from(schema.paymentStreams)
        .where(eq(schema.paymentStreams.trancheId, input.trancheId))
        .for('update');
      const [owner] = await tx
        .select()
        .from(schema.apiTrancheOwners)
        .where(
          and(
            eq(schema.apiTrancheOwners.trancheId, input.trancheId),
            eq(schema.apiTrancheOwners.platformId, input.platformId),
          ),
        );
      if (!stream?.record || !owner) throw new FundingStoreError('NOT_FOUND');
      const [prior] = await tx
        .select()
        .from(schema.fundingOperations)
        .where(eq(schema.fundingOperations.key, input.key));
      if (prior) {
        if (
          !same(
            Object.fromEntries(Object.keys(input).map((k) => [k, prior.instruction[k as keyof FundingReservation]])),
            input,
          )
        )
          throw new FundingStoreError('IDENTITY_CONFLICT');
        return snapshot(prior);
      }
      if (stream.version !== input.expectedVersion) throw new FundingStoreError('STALE_VERSION');
      const tranche = restoreTrancheRecord(stream.record);
      if (tranche.safeRecovery || !['PENDING', 'WAIT_FUNDING'].includes(tranche.state))
        throw new FundingStoreError('CONFLICT');
      const [active] = await tx
        .select()
        .from(schema.fundingOperations)
        .where(
          and(
            eq(schema.fundingOperations.trancheId, input.trancheId),
            inArray(schema.fundingOperations.status, [...unresolved]),
          ),
        );
      const [payment] = await tx
        .select()
        .from(schema.paymentOperations)
        .where(
          and(
            eq(schema.paymentOperations.trancheId, input.trancheId),
            inArray(schema.paymentOperations.status, ['RESERVED', 'AMBIGUOUS']),
          ),
        );
      if (active || payment) throw new FundingStoreError('CONFLICT');
      const [allowance] = await tx
        .select()
        .from(schema.apiAllowances)
        .where(
          and(eq(schema.apiAllowances.id, owner.allowanceId), eq(schema.apiAllowances.platformId, input.platformId)),
        );
      if (!allowance) throw new FundingStoreError('NOT_FOUND');
      // T-0154: a signed saved-PayPal mandate means PayPal authorizes at create, with no buyer present.
      const [mandate] = await tx
        .select({ key: schema.mandateSignatures.key })
        .from(schema.mandateSignatures)
        .where(
          and(
            eq(schema.mandateSignatures.allowanceId, allowance.id),
            eq(schema.mandateSignatures.platformId, input.platformId),
            eq(schema.mandateSignatures.mode, input.mode),
            eq(schema.mandateSignatures.status, 'SIGNED'),
          ),
        );
      const [row] = await tx
        .insert(schema.fundingOperations)
        .values({
          key: input.key,
          trancheId: input.trancheId,
          instruction: {
            ...input,
            amount: tranche.amount.toJSON(),
            payeeRef: allowance.body.payee_ref,
            allowanceId: allowance.id,
            ...(mandate ? { source: 'SAVED_PAYPAL' as const } : {}),
          },
          version: 0,
          status: 'RESERVED',
          createRequestId: randomUUID(),
          authorizeRequestId: randomUUID(),
        })
        .returning();
      await this.event(tx, row!);
      return snapshot(row!);
    });
  }
  async load(key: string): Promise<FundingOperation> {
    const [row] = await this.db.select().from(schema.fundingOperations).where(eq(schema.fundingOperations.key, key));
    if (!row) throw new FundingStoreError('NOT_FOUND');
    return snapshot(row);
  }
  async events(key: string) {
    return this.db
      .select()
      .from(schema.fundingEvents)
      .where(eq(schema.fundingEvents.key, key))
      .orderBy(asc(schema.fundingEvents.version));
  }
  beginCreate(key: string, version: number) {
    return this.begin(key, version, 'RESERVED', 'CREATING');
  }
  beginAuthorize(key: string, version: number) {
    return this.begin(key, version, 'AWAITING_APPROVAL', 'AUTHORIZING');
  }
  private begin(key: string, version: number, from: Row['status'], to: Row['status']) {
    return this.locked(key, async (tx, row) => {
      if (row.status !== from) throw new FundingStoreError('CONFLICT');
      if (row.version !== version) throw new FundingStoreError('STALE_VERSION');
      return this.update(tx, row, { status: to });
    });
  }
  orderCreated(key: string, order: Readonly<{ orderId: string; approvalUrl: string }>) {
    return this.locked(key, async (tx, row) => {
      if (
        !order ||
        !text(order.orderId) ||
        typeof order.approvalUrl !== 'string' ||
        Object.keys(order).some((k) => !['orderId', 'approvalUrl'].includes(k))
      )
        throw new FundingStoreError('INVALID');
      approvalChecked(order.approvalUrl, row.instruction.mode, order.orderId);
      if (row.orderId) {
        if (row.orderId !== order.orderId || row.approvalUrl !== order.approvalUrl)
          throw new FundingStoreError('IDENTITY_CONFLICT');
        return snapshot(row);
      }
      if (row.status !== 'CREATING') throw new FundingStoreError('CONFLICT');
      return this.update(tx, row, { ...order, status: 'AWAITING_APPROVAL' });
    });
  }
  confirm(key: string, value: FundingHold) {
    return this.resolveHold(key, value);
  }
  expire(key: string, value: FundingHold, now: number) {
    return this.resolveHold(key, value, now);
  }
  private resolveHold(key: string, value: FundingHold, now?: number) {
    const hold = structuredClone(value);
    return this.locked(key, async (tx, row) => {
      if (
        !hold ||
        Object.keys(hold).some(
          (k) => !['orderId', 'authorizationId', 'heldAt', 'expiresAt', 'reference'].includes(k),
        ) ||
        ![hold.orderId, hold.authorizationId, hold.reference].every(text) ||
        !Number.isSafeInteger(hold.heldAt) ||
        hold.heldAt < 0 ||
        !Number.isSafeInteger(hold.expiresAt) ||
        hold.expiresAt <= hold.heldAt ||
        hold.expiresAt - hold.heldAt > 29 * 86400000 ||
        (now !== undefined && (!Number.isSafeInteger(now) || now < hold.expiresAt))
      )
        throw new FundingStoreError('INVALID');
      const status = now === undefined ? 'HELD' : 'EXPIRED';
      if (row.status === 'HELD' || row.status === 'EXPIRED') {
        const { now: _now, ...previous } = row.hold!;
        if (row.status !== status || !same(previous, hold)) throw new FundingStoreError('IDENTITY_CONFLICT');
        return snapshot(row);
      }
      // A saved account's order is created already authorized, so its hold lands straight from CREATING.
      const atCreate = row.status === 'CREATING' && savedAccount(row) && status === 'HELD';
      if (row.status !== 'AUTHORIZING' && !atCreate) throw new FundingStoreError('CONFLICT');
      if (!atCreate && row.orderId !== hold.orderId) throw new FundingStoreError('IDENTITY_CONFLICT');
      await new PostgresTranches(this.db).applyInTransaction(
        tx,
        row.trancheId,
        row.instruction.expectedVersion,
        `funding:${key}:${status.toLowerCase()}`,
        {
          method: 'confirmFunding',
          args: [
            now === undefined
              ? {
                  kind: 'HELD',
                  authorizationId: hold.authorizationId,
                  nonce: row.instruction.nonce,
                  heldAt: hold.heldAt,
                  expiresAt: hold.expiresAt,
                  reference: hold.reference,
                }
              : {
                  kind: 'EXPIRED',
                  authorizationId: hold.authorizationId,
                  nonce: row.instruction.nonce,
                  heldAt: hold.heldAt,
                  expiresAt: hold.expiresAt,
                  reference: hold.reference,
                  now,
                },
          ],
        },
        key,
      );
      return this.update(tx, row, {
        status,
        ...(atCreate ? { orderId: hold.orderId } : {}),
        hold: now === undefined ? hold : { ...hold, now },
        reference: hold.reference,
      });
    });
  }
  fail(key: string, reference: string) {
    return this.locked(key, async (tx, row) => {
      if (!text(reference)) throw new FundingStoreError('INVALID');
      if (row.status === 'FAILED') {
        if (row.reference !== reference) throw new FundingStoreError('IDENTITY_CONFLICT');
        return snapshot(row);
      }
      if (row.status !== 'AUTHORIZING' && !(row.status === 'CREATING' && savedAccount(row)))
        throw new FundingStoreError('CONFLICT');
      await new PostgresTranches(this.db).applyInTransaction(
        tx,
        row.trancheId,
        row.instruction.expectedVersion,
        `funding:${key}:failed`,
        { method: 'confirmFunding', args: [{ kind: 'FAILED', reference }] },
        key,
      );
      return this.update(tx, row, { status: 'FAILED', reference });
    });
  }
  private async locked(
    key: string,
    change: (tx: Transaction, row: Row) => Promise<FundingOperation>,
  ): Promise<FundingOperation> {
    if (!text(key)) throw new FundingStoreError('INVALID');
    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select({ trancheId: schema.fundingOperations.trancheId })
        .from(schema.fundingOperations)
        .where(eq(schema.fundingOperations.key, key));
      if (!identity) throw new FundingStoreError('NOT_FOUND');
      await tx
        .select()
        .from(schema.paymentStreams)
        .where(eq(schema.paymentStreams.trancheId, identity.trancheId))
        .for('update');
      const [row] = await tx
        .select()
        .from(schema.fundingOperations)
        .where(eq(schema.fundingOperations.key, key))
        .for('update');
      if (!row) throw new FundingStoreError('NOT_FOUND');
      return change(tx, row);
    });
  }
  private async update(
    tx: Transaction,
    row: Row,
    values: Partial<Pick<Row, 'status' | 'orderId' | 'approvalUrl' | 'hold' | 'reference'>>,
  ) {
    const [next] = await tx
      .update(schema.fundingOperations)
      .set({ ...values, version: row.version + 1 })
      .where(eq(schema.fundingOperations.key, row.key))
      .returning();
    await this.event(tx, next!);
    return snapshot(next!);
  }
  private async event(tx: Transaction, row: Row) {
    await tx
      .insert(schema.fundingEvents)
      .values({ key: row.key, version: row.version, status: row.status, reference: row.reference });
  }
}
