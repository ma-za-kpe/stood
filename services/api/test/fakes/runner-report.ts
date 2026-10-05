import { type KeyObject, sign } from 'node:crypto';
import type { FrozenCodeContract } from '../../src/ports/runner-report.js';

const bindings = [
  'platformId',
  'allowanceId',
  'packageId',
  'repository',
  'baseCommit',
  'commit',
  'manifestHash',
  'runnerId',
  'imageDigest',
] as const;
// Synthetic signed findings only. This adapter never fetches, imports or executes a repository.
export function fakeReport(
  contract: FrozenCodeContract,
  privateKey: KeyObject,
  recordedAt: number,
  patch: Readonly<Record<string, unknown>> = {},
  keyId = 'fixture-2026-10',
): Readonly<{ keyId: string; payload: string; signature: string }> {
  const binding = Object.fromEntries(bindings.map((k) => [k, contract[k]]));
  const payload = JSON.stringify({
    ...binding,
    testBundleHash: contract.testBundleHash,
    tests: contract.testIds.map((id) => ({ id, status: 'PASS' })),
    diffHash: 'f'.repeat(64),
    mutationScore: 1,
    spentMinor: contract.maxMinor,
    currency: contract.currency,
    recordedAt,
    evidenceTier: 'fixture',
    ...patch,
  });
  return Object.freeze({
    keyId,
    payload,
    signature: sign(null, Buffer.from(`stood-runner-report/v1\0${keyId}\0${payload}`), privateKey).toString('base64'),
  });
}
