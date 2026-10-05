import { type KeyObject, verify } from 'node:crypto';
import type { CheckResult } from '../../domain/decision.js';
import type { FrozenCodeContract, RunnerReportVerifier } from '../../ports/runner-report.js';

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
const keys = [
  ...bindings,
  'testBundleHash',
  'tests',
  'diffHash',
  'mutationScore',
  'spentMinor',
  'currency',
  'recordedAt',
  'evidenceTier',
];
const hash = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export type RunnerSigningKey = Readonly<{
  id: string;
  runnerId: string;
  publicKey: KeyObject;
  notBefore: number;
  notAfter: number;
  revoked: boolean;
}>;
export class SignedReportVerifier implements RunnerReportVerifier {
  private readonly keys: readonly RunnerSigningKey[];
  constructor(
    keySet: readonly RunnerSigningKey[],
    private readonly clock: () => number,
    private readonly allowFixture = false,
  ) {
    if (
      !Array.isArray(keySet) ||
      !keySet.length ||
      keySet.length > 32 ||
      new Set(keySet.map((key) => key?.id)).size !== keySet.length ||
      keySet.some(
        (key) =>
          !key ||
          typeof key.id !== 'string' ||
          !/^[A-Za-z0-9_.-]{1,64}$/.test(key.id) ||
          typeof key.runnerId !== 'string' ||
          !key.runnerId.trim() ||
          key.runnerId.length > 128 ||
          key.publicKey?.type !== 'public' ||
          key.publicKey.asymmetricKeyType !== 'ed25519' ||
          !Number.isSafeInteger(key.notBefore) ||
          key.notBefore < 0 ||
          !Number.isSafeInteger(key.notAfter) ||
          key.notAfter <= key.notBefore ||
          typeof key.revoked !== 'boolean',
      )
    )
      throw new RangeError('Invalid runner key set');
    this.keys = Object.freeze(keySet.map((key) => Object.freeze({ ...key })));
  }
  verify(contract: FrozenCodeContract, envelope: unknown): readonly CheckResult[] | null {
    try {
      if (
        !object(envelope) ||
        Object.keys(envelope).sort().join() !== 'keyId,payload,signature' ||
        typeof envelope.keyId !== 'string' ||
        !/^[A-Za-z0-9_.-]{1,64}$/.test(envelope.keyId) ||
        typeof envelope.payload !== 'string' ||
        Buffer.byteLength(envelope.payload) > 65536 ||
        typeof envelope.signature !== 'string' ||
        !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)
      )
        return null;
      const key = this.keys.find((key) => key.id === envelope.keyId);
      const now = this.clock();
      if (
        !key ||
        key.revoked ||
        key.runnerId !== contract.runnerId ||
        !Number.isSafeInteger(now) ||
        now < key.notBefore ||
        now >= key.notAfter ||
        !verify(
          null,
          Buffer.from(`stood-runner-report/v1\0${envelope.keyId}\0${envelope.payload}`),
          key.publicKey,
          Buffer.from(envelope.signature, 'base64'),
        )
      )
        return null;
      const p: unknown = JSON.parse(envelope.payload);
      if (
        !object(p) ||
        Object.keys(p).sort().join() !== [...keys].sort().join() ||
        !Number.isFinite(now) ||
        typeof p.recordedAt !== 'number' ||
        !Number.isSafeInteger(p.recordedAt) ||
        p.recordedAt < key.notBefore ||
        p.recordedAt >= key.notAfter ||
        p.recordedAt > now ||
        now - p.recordedAt > 300000 ||
        !['attested', 'fixture'].includes(p.evidenceTier as string) ||
        (p.evidenceTier === 'fixture' && !this.allowFixture) ||
        !bindings.every((k) => typeof contract[k] === 'string' && contract[k].length > 0 && p[k] === contract[k]) ||
        !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(contract.repository) ||
        !/^[a-f0-9]{40}$/.test(contract.baseCommit) ||
        !/^[a-f0-9]{40}$/.test(contract.commit) ||
        !hash(contract.manifestHash) ||
        !hash(contract.testBundleHash) ||
        !hash(contract.imageDigest) ||
        !hash(p.testBundleHash) ||
        !hash(p.diffHash) ||
        !Number.isSafeInteger(contract.maxMinor) ||
        contract.maxMinor < 0 ||
        !Number.isFinite(contract.minMutation) ||
        contract.minMutation < 0 ||
        contract.minMutation > 1 ||
        !['code.milestone@1', 'code.final@1'].includes(contract.profileId) ||
        p.currency !== contract.currency ||
        !['GBP', 'USD', 'EUR'].includes(contract.currency) ||
        typeof p.spentMinor !== 'number' ||
        !Number.isSafeInteger(p.spentMinor) ||
        p.spentMinor < 0 ||
        typeof p.mutationScore !== 'number' ||
        !Number.isFinite(p.mutationScore) ||
        p.mutationScore < 0 ||
        p.mutationScore > 1 ||
        !Array.isArray(p.tests) ||
        p.tests.length > 10000 ||
        !contract.testIds.length ||
        new Set(contract.testIds).size !== contract.testIds.length
      )
        return null;
      const tests = p.tests;
      if (
        !tests.every(
          (t) =>
            object(t) &&
            Object.keys(t).sort().join() === 'id,status' &&
            typeof t.id === 'string' &&
            t.id.length > 0 &&
            ['PASS', 'FAIL', 'SKIP'].includes(t.status as string),
        ) ||
        new Set(tests.map((t) => t.id)).size !== tests.length
      )
        return null;
      const execution =
        tests.length === contract.testIds.length &&
        tests.every((t) => contract.testIds.includes(t.id) && t.status === 'PASS');
      const check = (code: string, pass: boolean, field: string, reason: string): CheckResult =>
        Object.freeze({
          code,
          source: 'RULE',
          status: pass ? 'PASS' : 'FAIL',
          namedField: field,
          reason: pass ? 'signed_report_passed' : reason,
        });
      return Object.freeze([
        check('signed_tests', true, 'signed_tests', 'signed_manifest'),
        check(
          'test_integrity',
          p.testBundleHash === contract.testBundleHash,
          'signed_tests_changed',
          'signed_tests_changed',
        ),
        check('test_execution', execution, 'tests_skipped', 'tests_skipped'),
        check(
          'new_commit',
          contract.commit !== contract.baseCommit && !contract.priorDiffHashes.includes(p.diffHash),
          'new_commit',
          'reused_commit',
        ),
        check('mutation_score', p.mutationScore >= contract.minMutation, 'weak_tests', 'weak_tests'),
        check('budget_mandate', p.spentMinor <= contract.maxMinor, 'budget_mandate', 'budget_mandate'),
      ]);
    } catch {
      return null;
    }
  }
}
