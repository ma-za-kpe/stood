import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { LedgerCapture } from '../../application/reconciliation-audit.js';
import { restoreTrancheRecord } from '../../domain/tranche-record.js';
import * as schema from './schema.js';

// Confirmed CAPTURE operations with their tranche amount, for the reconciliation audit.
export async function confirmedCaptures(
  db: NodePgDatabase<typeof schema>,
  trancheId?: string,
): Promise<LedgerCapture[]> {
  const { paymentOperations: ops, paymentStreams: streams } = schema;
  const rows = await db
    .select({ key: ops.key, trancheId: ops.trancheId, reference: ops.reference, record: streams.record })
    .from(ops)
    .innerJoin(streams, eq(streams.trancheId, ops.trancheId))
    .where(
      and(
        eq(ops.status, 'CONFIRMED'),
        sql`${ops.operation}->>'effect' = 'CAPTURE'`,
        trancheId ? eq(ops.trancheId, trancheId) : sql`true`,
      ),
    );
  return rows.map((r) => {
    const amount = restoreTrancheRecord(String(r.record)).amount;
    return {
      trancheId: r.trancheId,
      operationKey: r.key,
      reference: String(r.reference),
      minor: Number(amount.minor),
      currency: amount.currency,
    };
  });
}
