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
export const mandateTermsHash = (draft: StoredDraft): string =>
  createHash('sha256').update('stood.allowance.terms@1\n').update(canonicalMandate(draft)).digest('hex');
