import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { canonicalMandate, mandateTermsHash } from '../../application/mandate-terms.js';
import type { FundingAuthority } from '../../ports/funding-provider.js';
import type { FundingInstruction } from '../../ports/funding-store.js';
import {
  type Mandate,
  type MandateReservation,
  type MandateStore,
  MandateStoreError,
  type SetupReceipt,
  type TokenReceipt,
} from '../../ports/mandate-store.js';
import * as schema from './schema.js';

export { mandateTermsHash } from '../../application/mandate-terms.js';

type Database = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 200;
function fail(code: ConstructorParameters<typeof MandateStoreError>[0]): never {
  throw new MandateStoreError(code);
}
export class PostgresMandates implements MandateStore, FundingAuthority {
  constructor(private readonly db: Database) {}
  async reserve(value: MandateReservation): Promise<Mandate> {
    const input = structuredClone(value);
    if (
      !input ||
      Object.keys(input).some(
        (k) => !['key', 'platformId', 'allowanceId', 'termsVersion', 'termsHash', 'mode', 'acceptedAt'].includes(k),
      ) ||
      ![input.key, input.platformId, input.allowanceId].every(text) ||
      !/^[a-f0-9]{64}$/.test(input.termsHash) ||
      !Number.isSafeInteger(input.acceptedAt) ||
      input.acceptedAt < 0 ||
      !['sim', 'live'].includes(input.mode)
    )
      fail('INVALID');
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.key}, 91))`);
      const [allowance] = await tx
        .select()
        .from(schema.apiAllowances)
        .where(
          and(eq(schema.apiAllowances.id, input.allowanceId), eq(schema.apiAllowances.platformId, input.platformId)),
        )
        .for('update');
      if (!allowance) fail('NOT_FOUND');
      const [prior] = await tx
        .select()
        .from(schema.mandateSignatures)
        .where(eq(schema.mandateSignatures.key, input.key));
      if (prior) {
        if (Object.entries(input).some(([key, v]) => prior[key as keyof MandateReservation] !== v))
          fail('IDENTITY_CONFLICT');
        return structuredClone(prior);
      }
      if (input.termsVersion !== 1 || mandateTermsHash(allowance.body) !== input.termsHash) fail('IDENTITY_CONFLICT');
      const [active] = await tx
        .select()
        .from(schema.mandateSignatures)
        .where(
          and(
            eq(schema.mandateSignatures.allowanceId, input.allowanceId),
            ne(schema.mandateSignatures.status, 'REVOKED'),
          ),
        );
      if (active) fail('CONFLICT');
      const expiresAt = input.acceptedAt + allowance.body.window_days * 86400000;
      if (!Number.isSafeInteger(expiresAt)) fail('INVALID');
      const customerRef = createHash('sha256')
        .update(JSON.stringify(['stood.vault@1', input.key, input.platformId, input.allowanceId, input.termsHash]))
        .digest('hex');
      const [row] = await tx
        .insert(schema.mandateSignatures)
        .values({
          ...input,
          customerRef,
          expiresAt,
          status: 'RESERVED',
          version: 0,
          setupRequestId: randomUUID(),
          tokenRequestId: randomUUID(),
        })
        .returning();
      await this.event(tx, row!);
      return structuredClone(row!);
    });
  }
  async load(key: string): Promise<Mandate> {
    const [row] = await this.db.select().from(schema.mandateSignatures).where(eq(schema.mandateSignatures.key, key));
    if (!row) fail('NOT_FOUND');
    return structuredClone(row);
  }
  events(key: string) {
    return this.db
      .select()
      .from(schema.mandateEvents)
      .where(eq(schema.mandateEvents.key, key))
      .orderBy(asc(schema.mandateEvents.version));
  }
  // T-0154: the saved PayPal token for a signed mandate, read only when the PayPal adapter is about to call.
  async tokenFor(instruction: FundingInstruction): Promise<string | null> {
    const [row] = await this.db
      .select({ tokenId: schema.mandateSignatures.tokenId })
      .from(schema.mandateSignatures)
      .where(
        and(
          eq(schema.mandateSignatures.allowanceId, instruction.allowanceId),
          eq(schema.mandateSignatures.platformId, instruction.platformId),
          eq(schema.mandateSignatures.mode, instruction.mode),
          eq(schema.mandateSignatures.status, 'SIGNED'),
        ),
      );
    return row?.tokenId ?? null;
  }
  async canFund(instruction: FundingInstruction, now: number): Promise<boolean> {
    if (!Number.isSafeInteger(now) || now < 0) return false;
    const input = structuredClone(instruction);
    const [funding] = await this.db
      .select()
      .from(schema.fundingOperations)
      .where(eq(schema.fundingOperations.key, input.key));
    if (!funding || canonicalMandate(funding.instruction) !== canonicalMandate(input)) return false;
    const [row] = await this.db
      .select({ signature: schema.mandateSignatures, allowance: schema.apiAllowances })
      .from(schema.mandateSignatures)
      .innerJoin(
        schema.apiAllowances,
        and(
          eq(schema.apiAllowances.id, schema.mandateSignatures.allowanceId),
          eq(schema.apiAllowances.platformId, schema.mandateSignatures.platformId),
        ),
      )
      .where(
        and(
          eq(schema.mandateSignatures.allowanceId, input.allowanceId),
          eq(schema.mandateSignatures.platformId, input.platformId),
          eq(schema.mandateSignatures.status, 'SIGNED'),
        ),
      );
    if (
      !row ||
      row.signature.mode !== input.mode ||
      row.signature.termsVersion !== 1 ||
      now < row.signature.acceptedAt ||
      now >= row.signature.expiresAt ||
      row.signature.termsHash !== mandateTermsHash(row.allowance.body) ||
      row.allowance.body.payee_ref !== input.payeeRef
    )
      return false;
    const index = row.allowance.body.tranches.findIndex((tranche) => tranche.id === input.trancheId);
    const amount = row.allowance.body.milestones[index]?.amount;
    return amount?.minor === input.amount.minor && amount.currency === input.amount.currency;
  }
  beginCreate(key: string, version: number) {
    return this.mutate(key, (row) => {
      if (row.status !== 'RESERVED') fail('CONFLICT');
      if (row.version !== version) fail('STALE_VERSION');
      return { status: 'CREATING' as const };
    });
  }
  setupCreated(key: string, value: SetupReceipt) {
    const receipt = structuredClone(value);
    if (!id(receipt.setupId) || !id(receipt.customerId)) fail('INVALID');
    return this.mutate(key, (row) => {
      if (row.setupId) {
        if (
          row.setupId !== receipt.setupId ||
          row.customerId !== receipt.customerId ||
          row.approvalUrl !== receipt.approvalUrl
        )
          fail('IDENTITY_CONFLICT');
        return null;
      }
      if (row.status !== 'CREATING') fail('CONFLICT');
      if (receipt.approvalUrl !== null) {
        try {
          const url = new URL(receipt.approvalUrl);
          if (
            receipt.approvalUrl.length > 4000 ||
            url.username ||
            url.password ||
            url.hash ||
            (row.mode === 'sim'
              ? url.origin !== 'http://paypal-sim:8080' ||
                url.pathname !== `/__sim/setup-approve/${receipt.setupId}` ||
                !!url.search
              : url.origin !== 'https://www.sandbox.paypal.com')
          )
            throw new Error();
        } catch {
          fail('INVALID');
        }
      }
      return { ...receipt, status: 'AWAITING_APPROVAL' as const };
    });
  }
  beginTokenize(key: string, version: number, payerId: string) {
    if (!id(payerId)) fail('INVALID');
    return this.mutate(key, (row) => {
      if (row.status !== 'AWAITING_APPROVAL') fail('CONFLICT');
      if (row.version !== version) fail('STALE_VERSION');
      return { payerId, status: 'TOKENIZING' as const };
    });
  }
  confirm(key: string, value: TokenReceipt) {
    const receipt = structuredClone(value);
    if (![receipt.setupId, receipt.customerId, receipt.payerId, receipt.tokenId].every(id)) fail('INVALID');
    return this.mutate(key, (row) => {
      if (
        row.setupId !== receipt.setupId ||
        row.customerId !== receipt.customerId ||
        row.payerId !== receipt.payerId ||
        (row.tokenId && row.tokenId !== receipt.tokenId)
      )
        fail('IDENTITY_CONFLICT');
      if (row.status === 'SIGNED' || row.status === 'REVOKED') return null;
      if (row.status !== 'TOKENIZING') fail('CONFLICT');
      return { tokenId: receipt.tokenId, status: 'SIGNED' as const };
    });
  }
  revoke(platformId: string, key: string) {
    return this.mutate(key, (row) => {
      if (row.platformId !== platformId) fail('NOT_FOUND');
      if (row.status === 'REVOKED') return null;
      if (row.status !== 'SIGNED') fail('CONFLICT');
      return { status: 'REVOKED' as const };
    });
  }
  private async mutate(key: string, action: (row: Mandate) => Partial<Mandate> | null): Promise<Mandate> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.mandateSignatures)
        .where(eq(schema.mandateSignatures.key, key))
        .for('update');
      if (!row) fail('NOT_FOUND');
      const change = action(structuredClone(row));
      if (!change) return structuredClone(row);
      const [updated] = await tx
        .update(schema.mandateSignatures)
        .set({ ...change, version: row.version + 1 })
        .where(eq(schema.mandateSignatures.key, key))
        .returning();
      await this.event(tx, updated!);
      return structuredClone(updated!);
    });
  }
  private async event(tx: Tx, row: Mandate) {
    await tx
      .insert(schema.mandateEvents)
      .values({ key: row.key, version: row.version, status: row.status, snapshot: row });
  }
}
