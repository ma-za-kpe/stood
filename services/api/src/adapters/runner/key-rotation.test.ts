import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, it } from 'vitest';
import { fakeReport } from '../../../test/fakes/runner-report.js';
import { SignedReportVerifier } from './signed-report.js';

const now = 1790985600000;
const old = generateKeyPairSync('ed25519'),
  next = generateKeyPairSync('ed25519');
const contract = {
  platformId: 'platform',
  allowanceId: 'allowance',
  packageId: 'package',
  repository: 'buyer/project',
  baseCommit: 'a'.repeat(40),
  commit: 'b'.repeat(40),
  manifestHash: 'c'.repeat(64),
  testBundleHash: 'd'.repeat(64),
  testIds: ['works'],
  runnerId: 'runner',
  imageDigest: 'e'.repeat(64),
  maxMinor: 1000,
  currency: 'USD',
  minMutation: 0.8,
  profileId: 'code.milestone@1',
  priorDiffHashes: [],
};
const oldTrust = {
  id: 'old',
  runnerId: 'runner',
  publicKey: old.publicKey,
  notBefore: now - 1000000,
  notAfter: now + 1000,
  revoked: false,
};
const nextTrust = {
  id: 'next',
  runnerId: 'runner',
  publicKey: next.publicKey,
  notBefore: now - 1000,
  notAfter: now + 1000000,
  revoked: false,
};
const report = (key = old.privateKey, keyId = 'old', recordedAt = now) => {
  const { payload } = fakeReport(contract, key, recordedAt);
  return {
    keyId,
    payload,
    signature: sign(null, Buffer.from(`stood-runner-report/v1\0${keyId}\0${payload}`), key).toString('base64'),
  };
};
it('accepts either trusted signing key during a bounded overlap and rejects the retired key at expiry', () => {
  let time = now;
  const verifier = new SignedReportVerifier([oldTrust, nextTrust], () => time, true);
  expect(verifier.verify(contract, report())).not.toBeNull();
  expect(verifier.verify(contract, report(next.privateKey, 'next'))).not.toBeNull();
  time = oldTrust.notAfter;
  expect(verifier.verify(contract, report())).toBeNull();
  expect(verifier.verify(contract, report(next.privateKey, 'next', time))).not.toBeNull();
});
it('checks validity at issue and ingest, rejecting revoked, unknown and wrong-runner keys', () => {
  for (const key of [
    { ...oldTrust, revoked: true },
    { ...oldTrust, runnerId: 'other' },
    { ...oldTrust, notBefore: now + 1 },
    { ...oldTrust, notAfter: now },
  ])
    expect(new SignedReportVerifier([key], () => now, true).verify(contract, report())).toBeNull();
  const verifier = new SignedReportVerifier([oldTrust, nextTrust], () => now, true);
  expect(verifier.verify(contract, report(old.privateKey, 'unknown'))).toBeNull();
  expect(verifier.verify(contract, report(next.privateKey, 'next', nextTrust.notBefore - 1))).toBeNull();
});
it('cryptographically binds the key id, including when two registry entries reuse public material', () => {
  const verifier = new SignedReportVerifier([oldTrust, { ...oldTrust, id: 'alias' }], () => now, true);
  const envelope = report();
  expect(verifier.verify(contract, { ...envelope, keyId: 'alias' })).toBeNull();
  expect(verifier.verify(contract, { ...envelope, keyId: '../old' })).toBeNull();
  const { keyId: _id, ...legacy } = envelope;
  expect(verifier.verify(contract, legacy)).toBeNull();
});
it('refuses malformed trust configuration at construction rather than silently accepting a fallback', () => {
  for (const trust of [
    [],
    [oldTrust, oldTrust],
    [{ ...oldTrust, id: 'bad id' }],
    [{ ...oldTrust, id: 123 }],
    [{ ...oldTrust, runnerId: '' }],
    [{ ...oldTrust, notAfter: oldTrust.notBefore }],
    [{ ...oldTrust, notBefore: NaN }],
    [{ ...oldTrust, publicKey: old.privateKey }],
    [{ ...oldTrust, revoked: 'no' }],
    Array.from({ length: 33 }, (_, i) => ({ ...oldTrust, id: `key-${i}` })),
  ])
    expect(() => new SignedReportVerifier(trust as never, () => now, true)).toThrow('Invalid runner key set');
});
it('loads a private copy of trust metadata and applies revocation through an explicit reload', () => {
  const supplied = { ...oldTrust };
  const verifier = new SignedReportVerifier([supplied], () => now, true);
  supplied.id = 'changed';
  supplied.notAfter = now - 1;
  expect(verifier.verify(contract, report())).not.toBeNull();
  expect(
    new SignedReportVerifier([{ ...oldTrust, revoked: true }], () => now, true).verify(contract, report()),
  ).toBeNull();
});
