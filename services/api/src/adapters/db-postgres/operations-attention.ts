import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Attention, OperationsAttention } from '../../ports/operations-attention.js';
import type * as schema from './schema.js';

// T-0155: open reconciliation findings and open payment alerts, as counts and the oldest open time only.
export class PostgresOperationsAttention implements OperationsAttention {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async read(): Promise<Attention> {
    const { rows } = await this.db.execute<{ findings: number; alerts: number; oldest: string | null }>(sql`
      WITH open AS (
        SELECT 'finding' AS what, opened_at FROM reconciliation_findings WHERE status = 'OPEN'
        UNION ALL
        SELECT 'alert', opened_at FROM payment_alerts WHERE status = 'OPEN'
      )
      SELECT count(*) FILTER (WHERE what = 'finding')::int AS findings,
             count(*) FILTER (WHERE what = 'alert')::int AS alerts,
             to_char(min(opened_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS oldest
      FROM open`);
    const row = rows[0];
    return { openFindings: row?.findings ?? 0, openAlerts: row?.alerts ?? 0, oldestOpenedAt: row?.oldest ?? null };
  }
}
