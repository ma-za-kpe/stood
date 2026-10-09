import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fakeReport } from '../../../test/fakes/runner-report.js';
import { decide } from '../../domain/decision.js';
import { SignedReportVerifier } from './signed-report.js';

const keys = generateKeyPairSync('ed25519');
const contract = {
  platformId: 'platform',
  allowanceId: 'allowance',
  packageId: 'package',
  repository: 'owner/repo',
  baseCommit: 'a'.repeat(40),
  commit: 'b'.repeat(40),
  manifestHash: 'c'.repeat(64),
  testBundleHash: 'd'.repeat(64),
  testIds: ['acceptance:booking', 'acceptance:reminder'],
  runnerId: 'fixture-runner',
  imageDigest: 'e'.repeat(64),
  maxMinor: 120000,
  currency: 'USD',
  minMutation: 0.8,
  profileId: 'code.milestone@1',
  priorDiffHashes: [] as string[],
} as const;
const now = 1790985600000;
const trust = [
  {
    id: 'fixture-2026-10',
    runnerId: contract.runnerId,
    publicKey: keys.publicKey,
    notBefore: now - 1000000,
    notAfter: now + 1000000,
    revoked: false,
  },
];
const verifier = new SignedReportVerifier(trust, () => now, true);
describe('Bound signed runner reports, with no submitted code execution (T-0171)', () => {
  it('derives six RULE checks from the signed fake runner fixture, never usage authority', () => {
    expect(
      new SignedReportVerifier(trust, () => now).verify(contract, fakeReport(contract, keys.privateKey, now)),
    ).toBeNull();
    const checks = verifier.verify(contract, fakeReport(contract, keys.privateKey, now));
    expect(checks).not.toBeNull();
    expect(decide('code.milestone@1', checks ?? []).outcome).toBe('RELEASE');
    expect(decide('code.final@1', checks ?? []).outcome).toBe('WAIT');
    expect(checks?.some((c) => c.code === 'usage_release')).toBe(false);
  });
  it.each([
    'platformId',
    'allowanceId',
    'packageId',
    'repository',
    'baseCommit',
    'commit',
    'manifestHash',
    'runnerId',
    'imageDigest',
  ])('rejects a signed report for a different %s', (field) => {
    const report = fakeReport(contract, keys.privateKey, now, { [field]: 'other' });
    expect(verifier.verify(contract, report)).toBeNull();
  });
  it('rejects unsigned, edited, wrong-key, stale, future and malformed envelopes', () => {
    const report = fakeReport(contract, keys.privateKey, now);
    for (const bad of [
      null,
      {},
      { ...report, signature: 'bad' },
      { ...report, payload: report.payload + ' ' },
      fakeReport(contract, generateKeyPairSync('ed25519').privateKey, now),
      fakeReport(contract, keys.privateKey, now - 300001),
      fakeReport(contract, keys.privateKey, now + 1),
      { ...report, payload: 'x'.repeat(65537) },
    ])
      expect(verifier.verify(contract, bad)).toBeNull();
  });
  it.each([
    [{ testBundleHash: 'f'.repeat(64) }, 'REFUSE', 'signed_tests_changed'],
    [
      {
        tests: [
          { id: 'acceptance:booking', status: 'PASS' },
          { id: 'acceptance:reminder', status: 'SKIP' },
        ],
      },
      'REFUSE',
      'tests_skipped',
    ],
    [{ tests: [] }, 'REFUSE', 'tests_skipped'],
    // A test that ran and failed is named as failed, not skipped (live runner, 2026-10-09).
    [
      {
        tests: [
          { id: 'acceptance:booking', status: 'PASS' },
          { id: 'acceptance:reminder', status: 'FAIL' },
        ],
      },
      'REFUSE',
      'tests_failed',
    ],
    [{ mutationScore: 0.3 }, 'WAIT', null],
    [{ spentMinor: 120001 }, 'REFUSE', 'budget_mandate'],
  ])('derives a conservative assessment for %j', (patch, outcome, namedField) => {
    const checks = verifier.verify(contract, fakeReport(contract, keys.privateKey, now, patch));
    expect(checks).not.toBeNull();
    expect(decide(contract.profileId, checks ?? [])).toMatchObject({ outcome, namedField });
  });
  it('rejects malformed counts/score/budget, unrecognised fields and duplicate test identities', () => {
    for (const patch of [
      { mutationScore: null },
      { mutationScore: 2 },
      { spentMinor: -1 },
      { spentMinor: 1.5 },
      { currency: 'GBP' },
      { usage_release: 'PASS' },
      {
        tests: [
          { id: 'x', status: 'PASS' },
          { id: 'x', status: 'PASS' },
        ],
      },
      { tests: [{ id: 'x', status: 'UNKNOWN' }] },
    ])
      expect(verifier.verify(contract, fakeReport(contract, keys.privateKey, now, patch))).toBeNull();
  });
  it('refuses a replayed canonical diff or unchanged commit', () => {
    const report = fakeReport(contract, keys.privateKey, now);
    const payload = JSON.parse(report.payload);
    const checks = verifier.verify({ ...contract, priorDiffHashes: [payload.diffHash] }, report);
    expect(decide(contract.profileId, checks ?? []).outcome).toBe('REFUSE');
    const same = { ...contract, commit: contract.baseCommit };
    expect(
      decide(contract.profileId, verifier.verify(same, fakeReport(same, keys.privateKey, now)) ?? []).outcome,
    ).toBe('REFUSE');
  });
});
