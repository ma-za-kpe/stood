import { and, eq, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { RateLimiter } from '../../ports/rate-limiter.js';
import * as schema from './schema.js';

const { rateWindows: windows } = schema;

// T-0156: the counter in Postgres, so every API instance shares one budget. One statement adds and returns the count.
// When a scope opens a new window, its older windows are deleted, so the table holds about one row per scope.
export class PostgresRateLimits implements RateLimiter {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}
  async hit(scope: string, cost: number, windowStart: number): Promise<number> {
    if (!scope || scope.length > 200 || !Number.isSafeInteger(cost) || cost < 0) throw new Error('INVALID_RATE_HIT');
    const start = new Date(windowStart);
    if (cost === 0) {
      const [row] = await this.db
        .select({ count: windows.count })
        .from(windows)
        .where(and(eq(windows.scope, scope), eq(windows.windowStart, start)));
      return row?.count ?? 0;
    }
    const [row] = await this.db
      .insert(windows)
      .values({ scope, windowStart: start, count: cost })
      .onConflictDoUpdate({
        target: [windows.scope, windows.windowStart],
        set: { count: sql`${windows.count} + ${cost}` },
      })
      .returning({ count: windows.count });
    const count = row?.count ?? cost;
    if (count === cost)
      await this.db.delete(windows).where(and(eq(windows.scope, scope), lt(windows.windowStart, start)));
    return count;
  }
}
