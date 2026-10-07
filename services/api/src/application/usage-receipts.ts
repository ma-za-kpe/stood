import { type KeyObject, verify } from 'node:crypto';

// Ed25519 verification for usage receipts. A key that cannot verify (wrong type, bad bytes) is a failure.
export function ed25519Verifier(keys: Readonly<Record<string, KeyObject>>) {
  return (payload: string, signature: string, keyId: string): boolean => {
    const key = keys[keyId];
    if (!key || key.asymmetricKeyType !== 'ed25519') return false;
    try {
      return verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64'));
    } catch {
      return false;
    }
  };
}
