import { createPrivateKey, sign } from 'node:crypto';
import type { UsageSigner } from '../../application/usage-forwarder.js';

// C4 (#77): Yard's Ed25519 usage key (YARD_USAGE_KEY_ID, YARD_USAGE_SIGNING_KEY = base64 of a PKCS8 PEM). Stood lists
// its public half in USAGE_AUTHORITY_KEYS with the same key id and root. Null when absent or not Ed25519.
export const USAGE_ROOT = 'yard-buyers';
export function usageSigner(keyId: string | undefined, encoded: string | undefined): UsageSigner | null {
  const id = keyId?.trim() ?? '';
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id)) return null;
  try {
    const key = createPrivateKey(Buffer.from(encoded ?? '', 'base64').toString('utf8'));
    if (key.asymmetricKeyType !== 'ed25519') return null;
    return Object.freeze({
      keyId: id,
      root: USAGE_ROOT,
      sign: (payload: string) => sign(null, Buffer.from(payload), key).toString('base64'),
    });
  } catch {
    return null;
  }
}
