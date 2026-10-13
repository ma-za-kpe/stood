import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
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
import { readAllowanceVersion } from './allowance-versions.js';
import * as schema from './schema.js';
import type { TokenCipher } from './token-cipher.js';

export { mandateTermsHash } from '../../application/mandate-terms.js';

type Database = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 200;
function fail(code: ConstructorParameters<typeof MandateStoreError>[0]): never {
  throw new MandateStoreError(code);
}
type Row = typeof schema.mandateSignatures.$inferSelect;
export class PostgresMandates implements MandateStore, FundingAuthority {
  // T-0227: the saved token is sealed in token_id and opened only on its way out of the store.
  constructor(
    private readonly db: Database,
    private readonly cipher: TokenCipher,
  ) {}
  private reveal(row: Row): Mandate {
    const { tokenFingerprint: _fingerprint, lastPolledAt: _polled, ...mandate } = structuredClone(row);
    return { ...mandate, tokenId: row.tokenId === null ? null : this.cipher.open(row.tokenId, row.key) };
  }
  async reserve(value: MandateReservation): Promise<Mandate> {
    const input = structuredClone(value);
    if (
      !input ||
      Object.keys(input).some(
        (k) => !['key', 'platformId', 'allowanceId', 'termsVersion', 'termsHash', 'mode', 'acceptedAt'].includes(k),
      ) ||
      ![input.key, input.platformId, input.allowanceId].every(text) ||
      !/^[a-f0-9]{64}$/.test(input.termsHash) ||
      !Number.isSafeInteger(input.termsVersion) ||
      input.termsVersion < 1 ||
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
        // acceptedAt is assigned by the server on first acceptance, not part of the caller's retry identity.
        if (
          Object.entries(input).some(([key, v]) => key !== 'acceptedAt' && prior[key as keyof MandateReservation] !== v)
        )
          fail('IDENTITY_CONFLICT');
        return this.reveal(prior);
      }
      const terms = await readAllowanceVersion(tx, input.platformId, input.allowanceId);
      if (
        !terms ||
        input.termsVersion !== terms.version ||
        mandateTermsHash(terms.body, terms.version) !== input.termsHash
      )
        fail('IDENTITY_CONFLICT');
      const [active] = await tx
        .select()
        .from(schema.mandateSignatures)
        .where(
          and(
            eq(schema.mandateSignatures.allowanceId, input.allowanceId),
            eq(schema.mandateSignatures.termsVersion, input.termsVersion),
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
      await this.event(tx, row as Row);
      return this.reveal(row as Row);
    });
  }
  async load(key: string): Promise<Mandate> {
    const [row] = await this.db.select().from(schema.mandateSignatures).where(eq(schema.mandateSignatures.key, key));
    if (!row) fail('NOT_FOUND');
    return this.reveal(row);
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
      .select({ key: schema.mandateSignatures.key, tokenId: schema.mandateSignatures.tokenId })
      .from(schema.mandateSignatures)
      .where(
        and(
          eq(schema.mandateSignatures.allowanceId, instruction.allowanceId),
          eq(schema.mandateSignatures.platformId, instruction.platformId),
          eq(schema.mandateSignatures.termsVersion, instruction.termsVersion ?? 1),
          ...(instruction.mandateKey ? [eq(schema.mandateSignatures.key, instruction.mandateKey)] : []),
          eq(schema.mandateSignatures.mode, instruction.mode),
          eq(schema.mandateSignatures.status, 'SIGNED'),
        ),
      );
    return row?.tokenId ? this.cipher.open(row.tokenId, row.key) : null;
  }
  async canFund(instruction: FundingInstruction, now: number): Promise<boolean> {
    if (!Number.isSafeInteger(now) || now < 0) return false;
    const input = structuredClone(instruction);
    const [funding] = await this.db
      .select()
      .from(schema.fundingOperations)
      .where(eq(schema.fundingOperations.key, input.key));
    if (!funding || canonicalMandate(funding.instruction) !== canonicalMandate(input)) return false;
    const [signature] = await this.db
      .select()
      .from(schema.mandateSignatures)
      .where(
        and(
          eq(schema.mandateSignatures.allowanceId, input.allowanceId),
          eq(schema.mandateSignatures.platformId, input.platformId),
          eq(schema.mandateSignatures.termsVersion, input.termsVersion ?? 1),
          ...(input.mandateKey ? [eq(schema.mandateSignatures.key, input.mandateKey)] : []),
          eq(schema.mandateSignatures.status, 'SIGNED'),
        ),
      );
    const terms = await readAllowanceVersion(this.db, input.platformId, input.allowanceId, input.termsVersion ?? 1);
    if (
      !signature ||
      !terms ||
      signature.mode !== input.mode ||
      now < signature.acceptedAt ||
      now >= signature.expiresAt ||
      signature.termsHash !== mandateTermsHash(terms.body, terms.version) ||
      terms.body.payee_ref !== input.payeeRef
    )
      return false;
    const index = terms.body.tranches.findIndex((tranche) => tranche.id === input.trancheId);
    const amount = terms.body.milestones[index]?.amount;
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
  async expire(key: string, version: number, now: number): Promise<Mandate> {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(version) || version < 0) fail('INVALID');
    return this.mutate(key, (row) => {
      if (row.status === 'REVOKED') return null;
      if (row.version !== version) fail('STALE_VERSION');
      if (now < row.expiresAt || !['RESERVED', 'AWAITING_APPROVAL'].includes(row.status)) fail('CONFLICT');
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
      const change = action(this.reveal(row));
      if (!change) return this.reveal(row);
      const { tokenId, ...rest } = change;
      const sealed = tokenId
        ? { tokenId: this.cipher.seal(tokenId, key), tokenFingerprint: this.cipher.fingerprint(tokenId) }
        : {};
      const [updated] = await tx
        .update(schema.mandateSignatures)
        .set({ ...rest, ...sealed, version: row.version + 1 })
        .where(eq(schema.mandateSignatures.key, key))
        .returning();
      await this.event(tx, updated as Row);
      return this.reveal(updated as Row);
    });
  }
  // Durable round-robin polling: consent that can still progress precedes expired cleanup.
  async unresolved(now = Date.now()): Promise<string[]> {
    if (!Number.isSafeInteger(now) || now < 0) fail('INVALID');
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({ key: schema.mandateSignatures.key })
        .from(schema.mandateSignatures)
        .where(inArray(schema.mandateSignatures.status, ['RESERVED', 'CREATING', 'AWAITING_APPROVAL', 'TOKENIZING']))
        .orderBy(
          asc(sql`CASE WHEN ${schema.mandateSignatures.expiresAt} <= ${now} THEN 1 ELSE 0 END`),
          asc(schema.mandateSignatures.lastPolledAt),
          asc(schema.mandateSignatures.createdAt),
          asc(schema.mandateSignatures.key),
        )
        .limit(100)
        .for('update', { skipLocked: true });
      const keys = rows.map((r) => r.key);
      if (keys.length)
        await tx
          .update(schema.mandateSignatures)
          .set({ lastPolledAt: sql`GREATEST(${now}, ${schema.mandateSignatures.lastPolledAt} + 1)` })
          .where(inArray(schema.mandateSignatures.key, keys));
      return keys;
    });
  }
  // T-0227: re-seal every token not under the newest key. Same token, same fingerprint, one history event each.
  async rotateTokens(): Promise<number> {
    const rows = await this.db
      .select({ key: schema.mandateSignatures.key, tokenId: schema.mandateSignatures.tokenId })
      .from(schema.mandateSignatures)
      .where(isNotNull(schema.mandateSignatures.tokenId));
    let rotated = 0;
    for (const candidate of rows) {
      if (!candidate.tokenId || this.cipher.current(candidate.tokenId)) continue;
      rotated += await this.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(schema.mandateSignatures)
          .where(eq(schema.mandateSignatures.key, candidate.key))
          .for('update');
        if (!row?.tokenId || this.cipher.current(row.tokenId)) return 0;
        const [updated] = await tx
          .update(schema.mandateSignatures)
          .set({ tokenId: this.cipher.seal(this.cipher.open(row.tokenId, row.key), row.key), version: row.version + 1 })
          .where(eq(schema.mandateSignatures.key, row.key))
          .returning();
        await this.event(tx, updated as Row);
        return 1;
      });
    }
    return rotated;
  }
  private async event(tx: Tx, row: Row) {
    const { lastPolledAt: _polled, ...snapshot } = row;
    await tx.insert(schema.mandateEvents).values({ key: row.key, version: row.version, status: row.status, snapshot });
  }
}
