import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { ClaimState, RunClaims, RunKind } from '../../ports/run-claims.js';
import * as schema from './schema.js';

const { runClaims: claims } = schema;
// A job that waited is tried again after one minute, doubling per attempt up to an hour.
const BACKOFF = sql`least(interval '1 minute' * power(2, least(${claims.attempts} - 1, 10)), interval '1 hour')`;

// Audit 2026-10-10, finding 4: the lease is taken in one statement, so of two reconcilers only one runs a job.
// Second audit (2026-10-11): each lease carries its owner's token, so a runner that lost its lease cannot release or
// renew the next owner's.
export class PostgresRunClaims implements RunClaims {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async states(kind: RunKind, ids: readonly string[]): Promise<ReadonlyMap<string, ClaimState>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select({
        id: claims.jobId,
        attempts: claims.attempts,
        due: sql<boolean>`${claims.claimedUntil} <= clock_timestamp() AND ${claims.nextAttemptAt} <= clock_timestamp()`,
      })
      .from(claims)
      .where(and(eq(claims.kind, kind), inArray(claims.jobId, [...ids])));
    return new Map(rows.map((r) => [r.id, { attempts: r.attempts, due: r.due }]));
  }
  async claim(kind: RunKind, id: string, leaseMs: number) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error('INVALID_LEASE');
    const until = sql`clock_timestamp() + ${leaseMs} * interval '1 millisecond'`;
    const token = randomUUID();
    const [row] = await this.db
      .insert(claims)
      .values({ kind, jobId: id, attempts: 1, claimedUntil: until, token })
      .onConflictDoUpdate({
        target: [claims.kind, claims.jobId],
        set: { attempts: sql`${claims.attempts} + 1`, claimedUntil: until, token },
        setWhere: sql`${claims.claimedUntil} <= clock_timestamp() AND ${claims.nextAttemptAt} <= clock_timestamp()`,
      })
      .returning({ attempts: claims.attempts, token: claims.token });
    return row && row.token === token ? { attempts: row.attempts, token } : null;
  }
  async renew(kind: RunKind, id: string, token: string, leaseMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error('INVALID_LEASE');
    const rows = await this.db
      .update(claims)
      .set({ claimedUntil: sql`clock_timestamp() + ${leaseMs} * interval '1 millisecond'` })
      .where(and(eq(claims.kind, kind), eq(claims.jobId, id), eq(claims.token, token)))
      .returning({ id: claims.jobId });
    return rows.length === 1;
  }
  async release(kind: RunKind, id: string, token: string, waited: string | null): Promise<void> {
    const where = and(eq(claims.kind, kind), eq(claims.jobId, id), eq(claims.token, token));
    if (waited === null) {
      await this.db.delete(claims).where(where);
      return;
    }
    await this.db
      .update(claims)
      .set({
        claimedUntil: sql`clock_timestamp()`,
        nextAttemptAt: sql`clock_timestamp() + ${BACKOFF}`,
        lastReason: waited.slice(0, 200),
        token: null,
      })
      .where(where);
  }
}
