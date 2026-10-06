import type { Mandate, MandateStore, MandateTerms } from '../ports/mandate-store.js';
import type { VaultProvider } from '../ports/vault-provider.js';
import { mandateTermsHash } from './mandate-terms.js';

type Result =
  | Readonly<{ outcome: 'WAIT'; reason: 'PROVIDER_UNKNOWN' | 'CONSENT_EXPIRED' | 'TERMS_CHANGED' }>
  | Readonly<{ outcome: 'AWAITING_APPROVAL' | 'SIGNED' | 'REVOKED'; mandate: Mandate }>;
const wait = (reason: Extract<Result, { outcome: 'WAIT' }>['reason'] = 'PROVIDER_UNKNOWN'): Result => ({
  outcome: 'WAIT',
  reason,
});
const object = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
function matching(v: unknown, row: Mandate): Record<string, unknown> | null {
  const proof = object(v);
  return proof?.complete === true &&
    [
      'key',
      'platformId',
      'allowanceId',
      'termsVersion',
      'termsHash',
      'customerRef',
      'setupRequestId',
      'tokenRequestId',
    ].every((key) => proof[key] === row[key as keyof Mandate]) &&
    id(proof.setupId) &&
    id(proof.customerId) &&
    (!row.setupId || row.setupId === proof.setupId) &&
    (!row.customerId || row.customerId === proof.customerId)
    ? proof
    : null;
}
export async function advanceMandate(
  store: MandateStore,
  terms: MandateTerms,
  provider: VaultProvider,
  key: string,
  clock: () => number,
  candidates: Readonly<{ setupId?: string; tokenId?: string }> = {},
): Promise<Result> {
  try {
    let row = await store.load(key);
    if (row.status === 'SIGNED' || row.status === 'REVOKED') return { outcome: row.status, mandate: row };
    const permitted = async (): Promise<Result | null> => {
      const now = clock();
      if (!Number.isSafeInteger(now) || now < row.acceptedAt || now >= row.expiresAt) return wait('CONSENT_EXPIRED');
      const draft = await terms.load(row.platformId, row.allowanceId);
      return !draft || row.termsVersion !== 1 || mandateTermsHash(draft) !== row.termsHash
        ? wait('TERMS_CHANGED')
        : null;
    };
    const attachSetup = async (value: unknown): Promise<Result> => {
      const proof = matching(value, row);
      if (
        !proof ||
        !(
          (proof.outcome === 'CREATED' && typeof proof.approvalUrl === 'string') ||
          (proof.outcome === 'APPROVED' && id(proof.payerId))
        )
      )
        return wait();
      const mandate = await store.setupCreated(key, {
        setupId: proof.setupId as string,
        customerId: proof.customerId as string,
        approvalUrl: proof.outcome === 'APPROVED' ? null : (proof.approvalUrl as string),
      });
      return { outcome: 'AWAITING_APPROVAL', mandate };
    };
    const attachToken = async (value: unknown): Promise<Result> => {
      const proof = matching(value, row);
      if (
        !proof ||
        proof.outcome !== 'TOKENIZED' ||
        !id(proof.tokenId) ||
        !id(proof.payerId) ||
        proof.payerId !== row.payerId ||
        (candidates.tokenId && proof.tokenId !== candidates.tokenId)
      )
        return wait();
      return {
        outcome: 'SIGNED',
        mandate: await store.confirm(key, {
          setupId: proof.setupId as string,
          customerId: proof.customerId as string,
          payerId: proof.payerId,
          tokenId: proof.tokenId,
        }),
      };
    };
    if (row.status === 'CREATING') {
      if (!id(candidates.setupId)) return wait();
      const value = await provider.readSetup(row, candidates.setupId);
      if (object(value)?.setupId !== candidates.setupId) return wait();
      return attachSetup(value);
    }
    if (row.status === 'TOKENIZING') {
      if (!id(candidates.tokenId)) return wait();
      return attachToken(await provider.readToken(row, candidates.tokenId));
    }
    const rejected = await permitted();
    if (rejected) return rejected;
    if (row.status === 'RESERVED') {
      row = await store.beginCreate(key, row.version);
      const late = await permitted();
      if (late) return late;
      return attachSetup(await provider.createSetup(row));
    }
    const proof = matching(await provider.readSetup(row), row);
    if (!proof) return wait();
    if (proof.outcome === 'CREATED') return { outcome: 'AWAITING_APPROVAL', mandate: row };
    if (proof.outcome !== 'APPROVED' || !id(proof.payerId)) return wait();
    row = await store.beginTokenize(key, row.version, proof.payerId);
    const late = await permitted();
    if (late) return late;
    return attachToken(await provider.createToken(row));
  } catch {
    return wait();
  }
}
