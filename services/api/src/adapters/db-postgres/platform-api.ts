import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { allowanceDraft } from '../../application/allowance-draft.js';
import { createTrancheRecord } from '../../domain/tranche-record.js';
import {
  type DraftInput,
  type PlatformApiStore,
  PlatformApiStoreError,
  type StoredDraft,
} from '../../ports/platform-api-store.js';
import * as schema from './schema.js';
import { PostgresTranches } from './tranches.js';

export class PostgresPlatformApi implements PlatformApiStore {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async create(platformId: string, key: string, fingerprint: string, value: DraftInput): Promise<StoredDraft> {
    if (!platformId.trim() || !key.trim() || key.length > 200 || !/^[a-f0-9]{64}$/.test(fingerprint))
      throw new RangeError('Invalid request identity');
    const input = allowanceDraft(value);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([platformId, key])}, 0))`);
      const [prior] = await tx
        .select()
        .from(schema.apiRequests)
        .where(and(eq(schema.apiRequests.platformId, platformId), eq(schema.apiRequests.key, key)));
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw new PlatformApiStoreError();
        return prior.response;
      }
      const id = `alw_${randomUUID()}`;
      const tranches = input.milestones.map((milestone) => ({ id: `trn_${randomUUID()}`, name: milestone.name }));
      const response: StoredDraft = { id, status: 'DRAFT', ...input, tranches };
      await tx.insert(schema.apiAllowances).values({ id, platformId, body: response });
      for (const [index, milestone] of input.milestones.entries()) {
        const trancheId = tranches[index]!.id;
        const record = createTrancheRecord({
          id: trancheId,
          amount: milestone.amount,
          profileId: milestone.profile,
          maxResubmits: input.max_resubmits,
        });
        await tx.insert(schema.paymentStreams).values({ trancheId, record, initialRecord: record });
        await tx.insert(schema.apiTrancheOwners).values({ trancheId, allowanceId: id, platformId });
      }
      const [stored] = await tx
        .insert(schema.apiRequests)
        .values({ platformId, key, fingerprint, response })
        .returning();
      if (!stored) throw new Error('Missing persisted response');
      return stored.response;
    });
  }
  async allowance(platformId: string, id: string): Promise<StoredDraft | null> {
    const [row] = await this.db
      .select()
      .from(schema.apiAllowances)
      .where(and(eq(schema.apiAllowances.platformId, platformId), eq(schema.apiAllowances.id, id)));
    return row?.body ?? null;
  }
  async tranche(platformId: string, id: string) {
    const [owner] = await this.db
      .select()
      .from(schema.apiTrancheOwners)
      .where(and(eq(schema.apiTrancheOwners.platformId, platformId), eq(schema.apiTrancheOwners.trancheId, id)));
    return owner ? new PostgresTranches(this.db).load(id) : null;
  }
}
