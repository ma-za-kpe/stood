import { createHash } from 'node:crypto';
import type { StoredDraft } from '../ports/platform-api-store.js';
export function canonicalMandate(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalMandate).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonicalMandate(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function mandateTermsHash(draft: StoredDraft, version = 1): string {
  if (!Number.isSafeInteger(version) || version < 1) throw new RangeError('Invalid terms version');
  // Existing version-one signatures retain their exact historical digest.
  return createHash('sha256')
    .update(version === 1 ? 'stood.allowance.terms@1\n' : 'stood.allowance.terms@2\n')
    .update(canonicalMandate(version === 1 ? draft : { version, draft }))
    .digest('hex');
}
