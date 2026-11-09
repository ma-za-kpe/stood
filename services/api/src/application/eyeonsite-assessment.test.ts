import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  canonicalEyeOnSiteReceipt,
  type EyeOnSiteAssessmentPayload,
  verifyEyeOnSiteReceipt,
} from './eyeonsite-assessment.js';

const now = 1_797_000_000_000;
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const payload: EyeOnSiteAssessmentPayload = {
  schemaVersion: 1,
  issuer: 'eyeonsite',
  keyId: 'eos-test-1',
  evidenceId: 'ev_01J9ABC',
  taskId: 'task_01J9ABC',
  allowanceId: 'all_01J9ABC',
  termsVersion: 2,
  trancheId: 'trn_01J9ABC',
  uploadId: 'upl_01J9ABC',
  nonce: 'a'.repeat(64),
  issuedAt: now,
  photos: [
    { sha256: 'b'.repeat(64), bytes: 4096 },
    { sha256: 'c'.repeat(64), bytes: 8192 },
  ],
  assessment: {
    qualityScore: 82,
    gpsValid: true,
    fraudRisk: 'LOW',
    contentRisk: 'LOW',
    provenanceStatus: 'UNVERIFIED',
    attestationVerdict: 'UNKNOWN',
    signals: [],
  },
};
const expected = {
  evidenceId: payload.evidenceId,
  allowanceId: payload.allowanceId,
  termsVersion: payload.termsVersion,
  trancheId: payload.trancheId,
  uploadId: payload.uploadId,
  nonce: payload.nonce,
  photos: payload.photos,
};
const receipt = (value: typeof payload = payload) => ({
  payload: value,
  signature: sign(null, Buffer.from(canonicalEyeOnSiteReceipt(value)), privateKey).toString('base64url'),
});

it('verifies a signed receipt against its exact terms, upload, nonce and ordered photo hashes', () => {
  expect(verifyEyeOnSiteReceipt(receipt(), { 'eos-test-1': publicKey }, expected, now)).toEqual(payload);
});

it('refuses tampering, unknown signing keys and unknown receipt fields', () => {
  const signed = receipt();
  expect(() =>
    verifyEyeOnSiteReceipt({ ...signed, signature: 'A'.repeat(86) }, { 'eos-test-1': publicKey }, expected, now),
  ).toThrow();
  expect(() => verifyEyeOnSiteReceipt(signed, {}, expected, now)).toThrow();
  expect(() =>
    verifyEyeOnSiteReceipt(
      { ...signed, payload: { ...payload, forged: true } },
      { 'eos-test-1': publicKey },
      expected,
      now,
    ),
  ).toThrow();
});

it('refuses a valid signature bound to another allowance version, tranche, upload, nonce or photo set', () => {
  for (const patch of [
    { allowanceId: 'all_other' },
    { evidenceId: 'ev_other' },
    { termsVersion: 1 },
    { trancheId: 'trn_other' },
    { uploadId: 'upl_other' },
    { nonce: 'd'.repeat(64) },
    { photos: [{ sha256: 'f'.repeat(64), bytes: 4096 }, payload.photos[1]] },
  ]) {
    const signed = receipt({ ...payload, ...patch } as typeof payload);
    expect(() => verifyEyeOnSiteReceipt(signed, { 'eos-test-1': publicKey }, expected, now)).toThrow();
  }
});

it('refuses stale or future receipts and malformed findings', () => {
  expect(() =>
    verifyEyeOnSiteReceipt(
      receipt({ ...payload, issuedAt: now - 300_001 }),
      { 'eos-test-1': publicKey },
      expected,
      now,
    ),
  ).toThrow();
  expect(() =>
    verifyEyeOnSiteReceipt(receipt({ ...payload, issuedAt: now + 30_001 }), { 'eos-test-1': publicKey }, expected, now),
  ).toThrow();
  expect(() =>
    verifyEyeOnSiteReceipt(
      receipt({ ...payload, assessment: { ...payload.assessment, qualityScore: 101 } }),
      { 'eos-test-1': publicKey },
      expected,
      now,
    ),
  ).toThrow();
});

it('canonicalizes object key order while preserving photo order', () => {
  expect(canonicalEyeOnSiteReceipt({ ...payload, assessment: { ...payload.assessment } })).toBe(
    canonicalEyeOnSiteReceipt(payload),
  );
  expect(canonicalEyeOnSiteReceipt({ ...payload, photos: [...payload.photos].reverse() })).not.toBe(
    canonicalEyeOnSiteReceipt(payload),
  );
});
