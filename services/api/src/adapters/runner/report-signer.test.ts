import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signRunnerReport } from './report-signer.js';
import { SignedReportVerifier } from './signed-report.js';

const keys = generateKeyPairSync('ed25519');
const now = 1790985600000;
const contract = {
  platformId: 'platform',
  allowanceId: 'allowance',
  packageId: 'package',
  repository: 'owner/repo',
  baseCommit: 'a'.repeat(40),
  commit: 'b'.repeat(40),
  manifestHash: 'c'.repeat(64),
  testBundleHash: 'd'.repeat(64),
  testIds: ['t1', 't2'],
  runnerId: 'vercel-sandbox-runner',
  imageDigest: 'e'.repeat(64),
  maxMinor: 120000,
  currency: 'USD',
  minMutation: 0,
  profileId: 'code.milestone@1',
  priorDiffHashes: [] as string[],
};
const key = { id: 'runner-2026-10', privateKey: keys.privateKey };
// Production trust: attested reports only, no fixtures.
const verifier = new SignedReportVerifier(
  [
    {
      id: key.id,
      runnerId: contract.runnerId,
      publicKey: keys.publicKey,
      notBefore: now - 1e6,
      notAfter: now + 1e6,
      revoked: false,
    },
  ],
  () => now,
);
const run = (tests: { id: string; status: 'PASS' | 'FAIL' }[]) => ({
  contract,
  tests,
  diffHash: 'f'.repeat(64),
  mutationScore: 0,
  spentMinor: 0,
  recordedAt: now,
});

// T-0159: the runner's signed report is exactly what the verifier accepts: signed outside the VM, attested, and bound
// to the contract the buyer signed. Any change after signing makes it worthless.
describe('signRunnerReport', () => {
  it('produces an attested report the verifier accepts, passing only when every frozen test passed', () => {
    const passed = verifier.verify(
      contract,
      signRunnerReport(
        key,
        run([
          { id: 't1', status: 'PASS' },
          { id: 't2', status: 'PASS' },
        ]),
      ),
    );
    expect(passed?.every((c) => c.status === 'PASS')).toBe(true);
    const failed = verifier.verify(
      contract,
      signRunnerReport(
        key,
        run([
          { id: 't1', status: 'PASS' },
          { id: 't2', status: 'FAIL' },
        ]),
      ),
    );
    expect(failed?.find((c) => c.code === 'test_execution')?.status).toBe('FAIL');
  });

  it('is worthless when tampered with, signed by another key, or bound to another package', () => {
    const report = signRunnerReport(
      key,
      run([
        { id: 't1', status: 'PASS' },
        { id: 't2', status: 'PASS' },
      ]),
    );
    const tampered = { ...report, payload: report.payload.replace('"FAIL"', '"PASS"').replace('"t1"', '"t1 "') };
    expect(verifier.verify(contract, tampered)).toBeNull();
    const other = signRunnerReport(
      { id: key.id, privateKey: generateKeyPairSync('ed25519').privateKey },
      run([
        { id: 't1', status: 'PASS' },
        { id: 't2', status: 'PASS' },
      ]),
    );
    expect(verifier.verify(contract, other)).toBeNull();
    expect(verifier.verify({ ...contract, packageId: 'another' }, report)).toBeNull();
    expect(JSON.parse(report.payload).evidenceTier).toBe('attested');
  });
});
