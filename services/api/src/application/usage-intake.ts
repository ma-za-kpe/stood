import { createPublicKey, type KeyObject, verify } from 'node:crypto';
import { receiptPayload, type UsageReceipt, verifyUsageReceipt } from '../domain/usage-receipt.js';
import type { StoredUsage, UsageStore } from '../ports/usage-store.js';

export type UsageAuthority = Readonly<{ keyId: string; root: string; publicKey: KeyObject }>;
export type UsageOutcome =
  | Readonly<{ accepted: true; usage: StoredUsage }>
  | Readonly<{
      accepted: false;
      reason: 'not_found' | 'malformed' | 'binding' | 'stale' | 'replayed' | 'authority' | 'signature';
    }>;

// USAGE_AUTHORITY_KEYS: [{ keyId, root, publicKey: base64 of an Ed25519 SPKI PEM }]. Anything invalid is no authority.
export function usageAuthorities(value: string | undefined): readonly UsageAuthority[] {
  try {
    const list: unknown = JSON.parse(value ?? '[]');
    if (!Array.isArray(list)) return [];
    return list.flatMap((a) => {
      if (!a || typeof a.keyId !== 'string' || typeof a.root !== 'string' || typeof a.publicKey !== 'string') return [];
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(a.keyId) || !/^[A-Za-z0-9_.-]{1,100}$/.test(a.root)) return [];
      const key = createPublicKey(Buffer.from(a.publicKey, 'base64').toString('utf8'));
      return key.asymmetricKeyType === 'ed25519' ? [{ keyId: a.keyId, root: a.root, publicKey: key }] : [];
    });
  } catch {
    return [];
  }
}

// C4 (#77): a platform forwards the buyer's signed confirmation that the final milestone is in use. Stood checks it
// against the tranche's latest package commit, the configured authorities, freshness and replay, and stores it only
// when it verifies. The runner then re-decides the waiting final milestone with usage confirmed.
export async function acceptUsage(
  platformId: string,
  trancheId: string,
  receipt: UsageReceipt,
  deps: Readonly<{ store: UsageStore; authorities: readonly UsageAuthority[]; now: number }>,
): Promise<UsageOutcome> {
  const target = await deps.store.target(platformId, trancheId);
  if (!target) return { accepted: false, reason: 'not_found' };
  const keys = new Map(deps.authorities.map((a) => [a.keyId, a]));
  const prior = typeof receipt?.nonce === 'string' ? await deps.store.byNonce(receipt.nonce) : null;
  // The same receipt again (a retry after a lost reply) is the same acceptance; anything else with its nonce is a replay.
  if (prior) {
    // Compared by the signed bytes and the signature: stored JSON does not keep key order.
    let same = false;
    try {
      same =
        prior.usage.trancheId === trancheId &&
        prior.receipt.signature === receipt.signature &&
        receiptPayload(prior.receipt) === receiptPayload(receipt);
    } catch {
      same = false;
    }
    return same ? { accepted: true, usage: prior.usage } : { accepted: false, reason: 'replayed' };
  }
  const result = verifyUsageReceipt(receipt, {
    allowanceId: target.allowanceId,
    trancheId,
    commit: target.commit,
    // Stood holds no builder identities; the authority is the platform's own usage key, which signs only for the
    // buyer who owns the work (ADR-0026 trust note in docs/SETUP.md).
    builderRoots: [],
    authorities: Object.fromEntries(deps.authorities.map((a) => [a.keyId, { root: a.root }])),
    signatureValid: (payload, signature, keyId) => {
      const key = keys.get(keyId);
      try {
        return !!key && verify(null, Buffer.from(payload), key.publicKey, Buffer.from(signature, 'base64'));
      } catch {
        return false;
      }
    },
    now: deps.now,
    seen: () => false,
  });
  if (!result.ok) return { accepted: false, reason: result.reason };
  return { accepted: true, usage: await deps.store.record(platformId, receipt) };
}
