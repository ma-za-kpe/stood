import { createHash } from 'node:crypto';
import { and, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { AuditFinding } from '../../application/reconciliation-audit.js';
import * as schema from './schema.js';

const findingId = (f: AuditFinding) =>
  `finding_${createHash('sha256')
    .update(JSON.stringify([f.kind, f.providerId, f.operationKey]))
    .digest('hex')
    .slice(0, 32)}`;

// T-0155: durable reconciliation findings. Recording is idempotent (one row per finding, reopened if it
// returns); resolution happens only for captures the latest audit actually re-checked.
export class PostgresReconciliationFindings {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async record(findings: readonly AuditFinding[], owner: string): Promise<void> {
    const t = schema.reconciliationFindings;
    for (const f of findings)
      await this.db
        .insert(t)
        .values({
          id: findingId(f),
          kind: f.kind,
          trancheId: f.trancheId,
          providerId: f.providerId,
          operationKey: f.operationKey,
          owner,
        })
        .onConflictDoUpdate({
          target: t.id,
          set: { lastSeenAt: sql`clock_timestamp()`, owner, status: 'OPEN', resolvedAt: null },
        });
  }

  // Resolve open findings about captures this audit re-checked that are no longer findings.
  async resolveFixed(
    current: readonly AuditFinding[],
    checked: Readonly<{ operationKeys: readonly string[]; providerIds: readonly string[] }>,
  ): Promise<number> {
    const t = schema.reconciliationFindings;
    const subject = [
      ...(checked.operationKeys.length ? [inArray(t.operationKey, [...checked.operationKeys])] : []),
      ...(checked.providerIds.length ? [inArray(t.providerId, [...checked.providerIds])] : []),
    ];
    if (!subject.length) return 0;
    const keep = current.map(findingId);
    const resolved = await this.db
      .update(t)
      .set({ status: 'RESOLVED', resolvedAt: sql`clock_timestamp()` })
      .where(and(eq(t.status, 'OPEN'), or(...subject), ...(keep.length ? [notInArray(t.id, keep)] : [])))
      .returning({ id: t.id });
    return resolved.length;
  }
}
