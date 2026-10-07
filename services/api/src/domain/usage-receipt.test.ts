import { describe, expect, it } from 'vitest';
import { receiptPayload, usageCheck, verifyUsageReceipt } from './usage-receipt.js';

const at = 1790985600000;
const base = {
  version: 1 as const,
  allowanceId: 'alw_1',
  trancheId: 'trn_2',
  commit: 'b'.repeat(40),
  authority: { keyId: 'buyer-2026', root: 'buyer-root' },
  observedAt: at - 60000,
  nonce: 'n'.repeat(32),
};
// The domain takes the signature check as a function; a fixture "signature" is the payload's marker.
const signed = (r = base, signer = 'buyer') => ({ ...r, signature: `${signer}:${receiptPayload(r)}` });
const context = {
  allowanceId: 'alw_1',
  trancheId: 'trn_2',
  commit: 'b'.repeat(40),
  builderRoots: ['crew-root'],
  authorities: { 'buyer-2026': { root: 'buyer-root' } },
  signatureValid: (payload: string, signature: string, keyId: string) =>
    keyId === 'buyer-2026' && signature === `buyer:${payload}`,
  now: at,
  seen: (nonce: string) => nonce === 'u'.repeat(32),
};
describe('Independent usage receipts for the final release (T-0166)', () => {
  it('accepts a fresh, bound receipt signed by a registered outside authority', () => {
    expect(verifyUsageReceipt(signed(), context)).toEqual({ ok: true });
    expect(usageCheck(verifyUsageReceipt(signed(), context))).toEqual({
      code: 'usage_release',
      source: 'RULE',
      status: 'PASS',
      reason: 'outside_usage_confirmed',
    });
  });
  it.each([
    ['wrong allowance', { allowanceId: 'alw_other' }, 'binding'],
    ['wrong tranche', { trancheId: 'trn_other' }, 'binding'],
    ['wrong commit', { commit: 'c'.repeat(40) }, 'binding'],
    ['stale', { observedAt: at - 25 * 3600000 }, 'stale'],
    ['from the future', { observedAt: at + 6 * 60000 }, 'stale'],
    ['replayed nonce', { nonce: 'u'.repeat(32) }, 'replayed'],
    ['unknown authority', { authority: { keyId: 'nobody', root: 'x' } }, 'authority'],
    ['self-attested by the builder', { authority: { keyId: 'buyer-2026', root: 'crew-root' } }, 'authority'],
  ] as const)('refuses a receipt that is %s', (_label, patch, reason) => {
    expect(verifyUsageReceipt(signed({ ...base, ...patch } as typeof base), context)).toEqual({ ok: false, reason });
  });
  it('refuses forged signatures, circular demand inside the builder tree and malformed receipts', () => {
    expect(verifyUsageReceipt(signed(base, 'forger'), context)).toEqual({ ok: false, reason: 'signature' });
    const circular = { ...context, authorities: { 'buyer-2026': { root: 'crew-root' } } };
    expect(verifyUsageReceipt(signed(), circular)).toEqual({ ok: false, reason: 'authority' });
    expect(verifyUsageReceipt({ ...signed(), version: 2 } as never, context)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(verifyUsageReceipt(null as never, context)).toEqual({ ok: false, reason: 'malformed' });
    for (const patch of [
      { commit: undefined },
      { authority: undefined },
      { authority: { keyId: 7, root: 'buyer-root' } },
      { authority: { keyId: 'buyer-2026', root: null } },
      { observedAt: Number.NaN },
      { nonce: 'short' },
      { allowanceId: '' },
      { trancheId: 't'.repeat(201) },
    ])
      expect(verifyUsageReceipt({ ...signed(), ...patch } as never, context)).toEqual({
        ok: false,
        reason: 'malformed',
      });
    // Anything that is not a verified receipt waits; it never releases.
    expect(usageCheck({ ok: false, reason: 'stale' })).toMatchObject({ status: 'UNCERTAIN', reason: 'usage_stale' });
  });
});
