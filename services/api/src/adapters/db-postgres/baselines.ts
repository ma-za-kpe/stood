import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { type CodeTerms, codeTerms } from '../../application/code-terms.js';
import {
  type BaselineJob,
  type BaselineResult,
  type BaselineStore,
  BaselineStoreError,
  type StoredBaseline,
} from '../../ports/baseline-store.js';
import * as schema from './schema.js';

const { baselines } = schema;
const view = (row: typeof baselines.$inferSelect): StoredBaseline =>
  Object.freeze({
    id: row.id,
    status: row.status,
    terms: codeTerms(row.terms),
    result: row.result ? structuredClone(row.result) : null,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  });

// C4 (#77): baselines requested by a platform. Idempotent per platform and key: the same key with the same terms
// returns the same baseline; different terms are a conflict. The result is written once.
export class PostgresBaselines implements BaselineStore {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async request(platformId: string, key: string, fingerprint: string, input: CodeTerms): Promise<StoredBaseline> {
    let terms: CodeTerms;
    try {
      terms = codeTerms(input);
    } catch {
      throw new BaselineStoreError('INVALID');
    }
    if (!key.trim() || key.length > 200 || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new BaselineStoreError('INVALID');
    const [inserted] = await this.db
      .insert(baselines)
      .values({ id: `bl_${randomUUID()}`, platformId, key, fingerprint, terms })
      .onConflictDoNothing({ target: [baselines.platformId, baselines.key] })
      .returning();
    if (inserted) return view(inserted);
    const [prior] = await this.db
      .select({ row: baselines, same: sql<boolean>`${baselines.terms} = ${JSON.stringify(terms)}::jsonb` })
      .from(baselines)
      .where(and(eq(baselines.platformId, platformId), eq(baselines.key, key)));
    if (!prior?.same || prior.row.fingerprint !== fingerprint) throw new BaselineStoreError('CONFLICT');
    return view(prior.row);
  }
  async get(platformId: string, id: string): Promise<StoredBaseline | null> {
    const [row] = await this.db
      .select()
      .from(baselines)
      .where(and(eq(baselines.platformId, platformId), eq(baselines.id, id)));
    return row ? view(row) : null;
  }
  async pending(limit: number): Promise<readonly BaselineJob[]> {
    const rows = await this.db
      .select({ id: baselines.id, platformId: baselines.platformId, terms: baselines.terms })
      .from(baselines)
      .where(eq(baselines.status, 'QUEUED'))
      .orderBy(asc(baselines.createdAt), asc(baselines.id))
      .limit(Math.max(1, Math.min(limit, 50)));
    return rows.map((r) => Object.freeze({ id: r.id, platformId: r.platformId, terms: codeTerms(r.terms) }));
  }
  async finish(
    id: string,
    outcome: Readonly<{ status: 'DONE'; result: BaselineResult } | { status: 'INVALID' }>,
  ): Promise<void> {
    // Only a queued baseline is finished; a second runner finishing the same one changes nothing.
    await this.db
      .update(baselines)
      .set({
        status: outcome.status,
        result: outcome.status === 'DONE' ? outcome.result : null,
        finishedAt: sql`clock_timestamp()`,
      })
      .where(and(eq(baselines.id, id), eq(baselines.status, 'QUEUED')));
  }
}
