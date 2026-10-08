import type { ProviderCapture } from '../ports/provider-transactions.js';

// A confirmed CAPTURE in Stood's ledger: the operation key is sent to PayPal as invoice_id.
export type LedgerCapture = Readonly<{
  trancheId: string;
  operationKey: string;
  reference: string;
  minor: number;
  currency: string;
  // When Stood created the capture operation (epoch ms).
  at?: number;
}>;
export type AuditFinding = Readonly<{
  kind: 'CAPTURE_WITHOUT_RELEASE' | 'RELEASE_WITHOUT_CAPTURE' | 'AMOUNT_MISMATCH' | 'DUPLICATE_CAPTURE';
  trancheId: string | null;
  providerId: string | null;
  operationKey: string | null;
}>;
// T-0155: every provider capture must match exactly one confirmed ledger capture, and vice versa.
// Findings are for a person to resolve; the audit never moves or reverses money.
// T-0259: invoice ids of captures made by the sandbox run tool (scripts/dev sandbox-run, the nightly job). Stood's own
// operation keys always contain ':', so they can never match.
const OPERATOR_RUN = /^sandbox-(release|refuse|vault-release|vault-refuse)-[0-9T-]+Z-settle$/;
export const isOperatorRun = (invoiceId: string | null) => !!invoiceId && OPERATOR_RUN.test(invoiceId);
export function auditCaptures(ledger: readonly LedgerCapture[], provider: readonly ProviderCapture[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const completed = provider.filter(
    (p) => (p.status === 'COMPLETED' || p.status === 'PENDING') && !isOperatorRun(p.invoiceId),
  );
  const byInvoice = new Map<string, ProviderCapture[]>();
  for (const p of completed) {
    const list = byInvoice.get(p.invoiceId ?? '') ?? [];
    list.push(p);
    byInvoice.set(p.invoiceId ?? '', list);
  }
  const keys = new Set(ledger.map((l) => l.operationKey));
  for (const p of completed)
    if (!p.invoiceId || !keys.has(p.invoiceId))
      findings.push({ kind: 'CAPTURE_WITHOUT_RELEASE', trancheId: null, providerId: p.id, operationKey: p.invoiceId });
  for (const l of ledger) {
    const matches = byInvoice.get(l.operationKey) ?? [];
    const exact = matches.find((p) => p.id === l.reference);
    if (!exact)
      findings.push({
        kind: 'RELEASE_WITHOUT_CAPTURE',
        trancheId: l.trancheId,
        providerId: null,
        operationKey: l.operationKey,
      });
    else if (exact.minor !== l.minor || exact.currency !== l.currency)
      findings.push({
        kind: 'AMOUNT_MISMATCH',
        trancheId: l.trancheId,
        providerId: exact.id,
        operationKey: l.operationKey,
      });
    if (matches.length > 1)
      for (const extra of matches.filter((p) => p.id !== l.reference))
        findings.push({
          kind: 'DUPLICATE_CAPTURE',
          trancheId: l.trancheId,
          providerId: extra.id,
          operationKey: l.operationKey,
        });
  }
  return findings;
}

// PayPal's Transaction Search can lag by up to about three hours.
export const SETTLE_MS = 3 * 3600000;
// T-0155: the audit as run on a schedule. A capture missing on one side is only a finding once it is older
// than SETTLE_MS (a PayPal capture with no known time is reported at once, so a person looks).
// Wrong amounts and duplicates never depend on timing.
export function auditSettled(
  ledger: readonly LedgerCapture[],
  provider: readonly ProviderCapture[],
  now: number,
): AuditFinding[] {
  const cutoff = now - SETTLE_MS;
  const providerTime = new Map(provider.map((p) => [p.id, p.at ?? null]));
  const ledgerTime = new Map(ledger.map((l) => [l.operationKey, l.at ?? null]));
  return auditCaptures(ledger, provider).filter((f) => {
    if (f.kind === 'CAPTURE_WITHOUT_RELEASE') {
      const at = providerTime.get(f.providerId ?? '');
      return at === null || at === undefined || at <= cutoff;
    }
    if (f.kind === 'RELEASE_WITHOUT_CAPTURE') {
      const at = ledgerTime.get(f.operationKey ?? '');
      return at === null || at === undefined || at <= cutoff;
    }
    return true;
  });
}
