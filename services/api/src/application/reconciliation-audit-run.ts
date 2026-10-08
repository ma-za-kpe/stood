import type { ProviderTransactions } from '../ports/provider-transactions.js';
import { type AuditFinding, auditSettled, type LedgerCapture } from './reconciliation-audit.js';

// PayPal Transaction Search answers at most 31 days per request; audit the last 30.
export const AUDIT_WINDOW_MS = 30 * 24 * 3600000;

export interface FindingsStore {
  record(findings: readonly AuditFinding[], owner: string): Promise<void>;
  resolveFixed(
    current: readonly AuditFinding[],
    checked: Readonly<{ operationKeys: readonly string[]; providerIds: readonly string[] }>,
  ): Promise<number>;
}

// T-0155: one scheduled audit. Read-only towards PayPal and the ledger; it records findings for a person.
export async function runReconciliationAudit(
  deps: Readonly<{
    ledger(): Promise<readonly LedgerCapture[]>;
    provider: ProviderTransactions;
    findings: FindingsStore;
    owner: string;
    now: number;
  }>,
): Promise<Readonly<{ checked: number; findings: number }>> {
  const from = deps.now - AUDIT_WINDOW_MS;
  const ledger = (await deps.ledger()).filter((l) => l.at === undefined || l.at >= from);
  const provider = await deps.provider.captures(from, deps.now);
  const findings = auditSettled(ledger, provider, deps.now);
  await deps.findings.record(findings, deps.owner);
  await deps.findings.resolveFixed(findings, {
    operationKeys: ledger.map((l) => l.operationKey),
    providerIds: provider.map((p) => p.id),
  });
  return { checked: ledger.length + provider.length, findings: findings.length };
}
