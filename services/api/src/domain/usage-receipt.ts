import type { CheckResult } from './decision.js';

export type UsageReceipt = Readonly<{
  version: 1;
  allowanceId: string;
  trancheId: string;
  commit: string;
  authority: Readonly<{ keyId: string; root: string }>;
  observedAt: number;
  nonce: string;
  signature: string;
}>;
export type UsageContext = Readonly<{
  allowanceId: string;
  trancheId: string;
  commit: string;
  builderRoots: readonly string[];
  authorities: Readonly<Record<string, Readonly<{ root: string }>>>;
  // Signature check supplied by the application layer (Ed25519); the domain stays free of I/O and crypto.
  signatureValid(payload: string, signature: string, keyId: string): boolean;
  now: number;
  seen(nonce: string): boolean;
}>;
type Reason = 'malformed' | 'binding' | 'stale' | 'replayed' | 'authority' | 'signature';
const MAX_AGE = 24 * 3600000;
const SKEW = 5 * 60000;
// Domain-separated bytes the outside authority signs. Never includes the signature itself.
export function receiptPayload(r: Omit<UsageReceipt, 'signature'>): string {
  return [
    'stood-usage-receipt/v1',
    r.allowanceId,
    r.trancheId,
    r.commit,
    r.authority.keyId,
    r.authority.root,
    String(r.observedAt),
    r.nonce,
  ].join('\0');
}
// The final milestone releases only on use confirmed by an authority outside the builder's tree.
export function verifyUsageReceipt(r: UsageReceipt, c: UsageContext): { ok: true } | { ok: false; reason: Reason } {
  const fail = (reason: Reason) => ({ ok: false as const, reason });
  if (
    !r ||
    typeof r !== 'object' ||
    r.version !== 1 ||
    ![r.allowanceId, r.trancheId, r.nonce, r.signature].every(
      (v) => typeof v === 'string' && v.length > 0 && v.length <= 200,
    ) ||
    !/^[a-f0-9]{40}$/.test(r.commit ?? '') ||
    !r.authority ||
    typeof r.authority.keyId !== 'string' ||
    typeof r.authority.root !== 'string' ||
    !Number.isSafeInteger(r.observedAt) ||
    !/^[A-Za-z0-9_-]{16,200}$/.test(r.nonce)
  )
    return fail('malformed');
  if (r.allowanceId !== c.allowanceId || r.trancheId !== c.trancheId || r.commit !== c.commit) return fail('binding');
  if (r.observedAt > c.now + SKEW || c.now - r.observedAt > MAX_AGE) return fail('stale');
  if (c.seen(r.nonce)) return fail('replayed');
  const authority = c.authorities[r.authority.keyId];
  // Self-attestation or demand from inside the builder's own operator tree is not outside usage.
  if (
    !authority ||
    authority.root !== r.authority.root ||
    c.builderRoots.includes(authority.root) ||
    c.builderRoots.includes(r.authority.root)
  )
    return fail('authority');
  const { signature, ...unsigned } = r;
  const valid = c.signatureValid(receiptPayload(unsigned), signature, r.authority.keyId);
  return valid ? { ok: true } : fail('signature');
}
export function usageCheck(result: ReturnType<typeof verifyUsageReceipt>): CheckResult {
  return result.ok
    ? { code: 'usage_release', source: 'RULE', status: 'PASS', reason: 'outside_usage_confirmed' }
    : { code: 'usage_release', source: 'RULE', status: 'UNCERTAIN', reason: `usage_${result.reason}` };
}
