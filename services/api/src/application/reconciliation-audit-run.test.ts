import { expect, it } from 'vitest';
import type { ProviderCapture } from '../ports/provider-transactions.js';
import type { AuditFinding, LedgerCapture } from './reconciliation-audit.js';
import { AUDIT_WINDOW_MS, runReconciliationAudit } from './reconciliation-audit-run.js';

const now = Date.parse('2026-10-08T12:00:00Z');
const hour = 3600000;
it('audits the last 30 days, records settled findings for the owner, and resolves what it re-checked (T-0155)', async () => {
  const ledger: LedgerCapture[] = [
    { trancheId: 't1', operationKey: 'op1', reference: 'CAP-1', minor: 1000, currency: 'USD', at: now - 5 * hour },
    { trancheId: 't2', operationKey: 'op2', reference: 'CAP-2', minor: 1000, currency: 'USD', at: now - 5 * hour },
    // Older than the window: not audited (Transaction Search cannot reach it).
    {
      trancheId: 't0',
      operationKey: 'old',
      reference: 'CAP-0',
      minor: 1000,
      currency: 'USD',
      at: now - 40 * 24 * hour,
    },
  ];
  const provider: ProviderCapture[] = [
    { id: 'CAP-1', invoiceId: 'op1', minor: 1000, currency: 'USD', status: 'COMPLETED', at: now - 5 * hour },
  ];
  const windows: [number, number][] = [];
  const recorded: { findings: readonly AuditFinding[]; owner: string }[] = [];
  const resolved: { checked: { operationKeys: readonly string[]; providerIds: readonly string[] } }[] = [];
  const result = await runReconciliationAudit({
    ledger: async () => ledger,
    provider: {
      captures: async (from, to) => {
        windows.push([from, to]);
        return provider;
      },
    },
    findings: {
      record: async (findings, owner) => void recorded.push({ findings, owner }),
      resolveFixed: async (_current, checked) => {
        resolved.push({ checked });
        return 0;
      },
    },
    owner: 'reviewer',
    now,
  });
  expect(windows).toEqual([[now - AUDIT_WINDOW_MS, now]]);
  expect(AUDIT_WINDOW_MS).toBeLessThanOrEqual(31 * 24 * hour);
  expect(recorded).toEqual([
    {
      owner: 'reviewer',
      findings: [{ kind: 'RELEASE_WITHOUT_CAPTURE', trancheId: 't2', providerId: null, operationKey: 'op2' }],
    },
  ]);
  expect(resolved[0]?.checked).toEqual({ operationKeys: ['op1', 'op2'], providerIds: ['CAP-1'] });
  expect(result).toEqual({ checked: 3, findings: 1 });
});
