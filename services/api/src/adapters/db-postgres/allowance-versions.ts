import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { allowanceAmendment } from '../../application/allowance-amendment.js';
import { allowanceDraft } from '../../application/allowance-draft.js';
import { canonicalMandate } from '../../application/mandate-terms.js';
import {
  type AllowanceVersion,
  AllowanceVersionError,
  type AllowanceVersionStore,
} from '../../ports/allowance-version-store.js';
import type { DraftInput } from '../../ports/platform-api-store.js';
import * as schema from './schema.js';

type Database = NodePgDatabase<typeof schema>;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export async function readAllowanceVersion(
  db: Database | Tx,
  platformId: string,
  allowanceId: string,
  version?: number,
): Promise<AllowanceVersion | null> {
  if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) return null;
  const [original] = await db
    .select()
    .from(schema.apiAllowances)
    .where(and(eq(schema.apiAllowances.id, allowanceId), eq(schema.apiAllowances.platformId, platformId)));
  if (!original) return null;
  if (version !== 1) {
    const [row] = await db
      .select()
      .from(schema.allowanceVersions)
      .where(
        and(
          eq(schema.allowanceVersions.allowanceId, allowanceId),
          eq(schema.allowanceVersions.platformId, platformId),
          ...(version === undefined ? [] : [eq(schema.allowanceVersions.termsVersion, version)]),
        ),
      )
      .orderBy(desc(schema.allowanceVersions.termsVersion))
      .limit(1);
    if (row) return { version: row.termsVersion, body: structuredClone(row.body) };
    if (version !== undefined) return null;
  }
  return { version: 1, body: structuredClone(original.body) };
}
export class PostgresAllowanceVersions implements AllowanceVersionStore {
  constructor(private readonly db: Database) {}
  read(platformId: string, allowanceId: string, version?: number) {
    return readAllowanceVersion(this.db, platformId, allowanceId, version);
  }
  async propose(
    platformId: string,
    allowanceId: string,
    key: string,
    expectedVersion: number,
    value: DraftInput,
  ): Promise<AllowanceVersion> {
    if (
      ![platformId, allowanceId, key].every((s) => typeof s === 'string' && !!s.trim() && s.length <= 200) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1 ||
      expectedVersion >= 2147483647
    )
      throw new AllowanceVersionError('INVALID');
    const input = allowanceDraft(value);
    const fingerprint = createHash('sha256').update(canonicalMandate({ expectedVersion, input })).digest('hex');
    return this.db.transaction(async (tx) => {
      // Funding locks a tranche before looking up its allowance. Acquire every owned stream in stable order
      // before the allowance lock, so a reservation either commits first and fences the edit, or sees new terms.
      const owners = await tx
        .select()
        .from(schema.apiTrancheOwners)
        .where(
          and(eq(schema.apiTrancheOwners.allowanceId, allowanceId), eq(schema.apiTrancheOwners.platformId, platformId)),
        );
      if (!owners.length) throw new AllowanceVersionError('NOT_FOUND');
      const ids = owners.map((o) => o.trancheId);
      const streams = await tx
        .select()
        .from(schema.paymentStreams)
        .where(inArray(schema.paymentStreams.trancheId, ids))
        .orderBy(asc(schema.paymentStreams.trancheId))
        .for('update');
      const [original] = await tx
        .select()
        .from(schema.apiAllowances)
        .where(and(eq(schema.apiAllowances.id, allowanceId), eq(schema.apiAllowances.platformId, platformId)))
        .for('update');
      if (!original || streams.length !== ids.length) throw new AllowanceVersionError('NOT_FOUND');
      const [prior] = await tx
        .select()
        .from(schema.allowanceVersions)
        .where(
          and(
            eq(schema.allowanceVersions.platformId, platformId),
            eq(schema.allowanceVersions.allowanceId, allowanceId),
            eq(schema.allowanceVersions.key, key),
          ),
        );
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new AllowanceVersionError('IDEMPOTENCY_CONFLICT');
        return { version: prior.termsVersion, body: structuredClone(prior.body) };
      }
      const current = await readAllowanceVersion(tx, platformId, allowanceId);
      if (!current || current.version !== expectedVersion) throw new AllowanceVersionError('STALE_VERSION');
      const fundings = await tx
        .select({ trancheId: schema.fundingOperations.trancheId })
        .from(schema.fundingOperations)
        .where(inArray(schema.fundingOperations.trancheId, ids));
      // Even failed or ambiguous intents retain their original terms; never infer permission from provider silence.
      const reserved = new Set(fundings.map((f) => f.trancheId));
      for (const stream of streams) if (stream.version > 0) reserved.add(stream.trancheId);
      const body = allowanceAmendment(current.body, input, reserved);
      const version = current.version + 1;
      await tx
        .insert(schema.allowanceVersions)
        .values({ allowanceId, platformId, key, fingerprint, body, termsVersion: version });
      return { version, body: structuredClone(body) };
    });
  }
}
