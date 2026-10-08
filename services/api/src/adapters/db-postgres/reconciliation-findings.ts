import { createHash } from 'node:crypto';
import { and, asc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
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
          // Reopen what the audit auto-resolved; a person's resolution (resolved_by set) stands.
          set: {
            lastSeenAt: sql`clock_timestamp()`,
            owner,
            status: sql`CASE WHEN ${t.resolvedBy} IS NULL THEN 'OPEN' ELSE ${t.status} END`,
            resolvedAt: sql`CASE WHEN ${t.resolvedBy} IS NULL THEN NULL ELSE ${t.resolvedAt} END`,
          },
        });
  }

  async open() {
    const t = schema.reconciliationFindings;
    return this.db
      .select({
        id: t.id,
        kind: t.kind,
        trancheId: t.trancheId,
        providerId: t.providerId,
        operationKey: t.operationKey,
        owner: t.owner,
        openedAt: t.openedAt,
      })
      .from(t)
      .where(eq(t.status, 'OPEN'))
      .orderBy(asc(t.openedAt));
  }

  // T-0257: a person closes a finding for good, with their name and the reason.
  async resolveByPerson(id: string, by: string, note: string): Promise<void> {
    if (!by.trim()) throw new Error('A resolution needs the name of the person resolving it');
    if (!note.trim()) throw new Error('A resolution needs a reason');
    const t = schema.reconciliationFindings;
    const done = await this.db
      .update(t)
      .set({
        status: 'RESOLVED',
        resolvedAt: sql`clock_timestamp()`,
        resolvedBy: by.trim(),
        resolutionNote: note.trim(),
      })
      .where(and(eq(t.id, id), eq(t.status, 'OPEN')))
      .returning({ id: t.id });
    if (!done.length) throw new Error('No open finding with that id');
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
