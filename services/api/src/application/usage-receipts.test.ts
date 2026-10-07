import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, it } from 'vitest';
import { receiptPayload, verifyUsageReceipt } from '../domain/usage-receipt.js';
import { ed25519Verifier } from './usage-receipts.js';

it('verifies usage receipts with Ed25519 and treats unusable keys as failures (T-0166)', () => {
  const buyer = generateKeyPairSync('ed25519'),
    forger = generateKeyPairSync('ed25519'),
    rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const at = 1790985600000;
  const r = {
    version: 1 as const,
    allowanceId: 'alw',
    trancheId: 'trn',
    commit: 'b'.repeat(40),
    authority: { keyId: 'k', root: 'buyer-root' },
    observedAt: at,
    nonce: 'n'.repeat(32),
  };
  const context = (keys: Record<string, import('node:crypto').KeyObject>) => ({
    allowanceId: 'alw',
    trancheId: 'trn',
    commit: 'b'.repeat(40),
    builderRoots: ['crew-root'],
    authorities: { k: { root: 'buyer-root' } },
    now: at,
    seen: () => false,
    signatureValid: ed25519Verifier(keys),
  });
  const good = { ...r, signature: sign(null, Buffer.from(receiptPayload(r)), buyer.privateKey).toString('base64') };
  expect(verifyUsageReceipt(good, context({ k: buyer.publicKey }))).toEqual({ ok: true });
  const forged = { ...r, signature: sign(null, Buffer.from(receiptPayload(r)), forger.privateKey).toString('base64') };
  expect(verifyUsageReceipt(forged, context({ k: buyer.publicKey }))).toEqual({ ok: false, reason: 'signature' });
  expect(verifyUsageReceipt(good, context({ k: rsa.publicKey }))).toEqual({ ok: false, reason: 'signature' });
  expect(verifyUsageReceipt({ ...good, signature: '!!' }, context({ k: buyer.publicKey }))).toEqual({
    ok: false,
    reason: 'signature',
  });
  expect(verifyUsageReceipt(good, context({}))).toEqual({ ok: false, reason: 'signature' });
});
