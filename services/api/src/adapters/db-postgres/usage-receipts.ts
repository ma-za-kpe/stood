import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { UsageReceipt } from '../../domain/usage-receipt.js';
import { type StoredUsage, type UsageStore, UsageStoreError } from '../../ports/usage-store.js';
import * as schema from './schema.js';

const { usageReceipts: receipts, commitPackages: packages, apiTrancheOwners: owners } = schema;
const view = (row: typeof receipts.$inferSelect): StoredUsage =>
  Object.freeze({ trancheId: row.trancheId, commit: row.commit, nonce: row.nonce, acceptedAt: row.acceptedAt });

// C4 (#77): verified usage receipts, one per nonce.
export class PostgresUsageReceipts implements UsageStore {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async target(platformId: string, trancheId: string) {
    const [owner] = await this.db
      .select({ allowanceId: owners.allowanceId })
      .from(owners)
      .where(and(eq(owners.platformId, platformId), eq(owners.trancheId, trancheId)));
    if (!owner) return null;
    const [latest] = await this.db
      .select({ metadata: packages.metadata })
      .from(packages)
      .where(and(eq(packages.platformId, platformId), eq(packages.trancheId, trancheId)))
      .orderBy(desc(packages.createdAt), desc(packages.id))
      .limit(1);
    return latest ? { allowanceId: owner.allowanceId, commit: latest.metadata.commit_sha } : null;
  }
  async byNonce(nonce: string) {
    const [row] = await this.db.select().from(receipts).where(eq(receipts.nonce, nonce));
    return row ? { usage: view(row), receipt: row.receipt } : null;
  }
  async record(platformId: string, receipt: UsageReceipt): Promise<StoredUsage> {
    const [row] = await this.db
      .insert(receipts)
      .values({ nonce: receipt.nonce, platformId, trancheId: receipt.trancheId, commit: receipt.commit, receipt })
      .onConflictDoNothing({ target: receipts.nonce })
      .returning();
    // Two requests racing with the same nonce: only the first is stored.
    if (!row) throw new UsageStoreError('REPLAYED');
    return view(row);
  }
  async find(trancheId: string, commit: string) {
    const [row] = await this.db
      .select()
      .from(receipts)
      .where(and(eq(receipts.trancheId, trancheId), eq(receipts.commit, commit)))
      .orderBy(desc(receipts.acceptedAt))
      .limit(1);
    return row ? view(row) : null;
  }
}
