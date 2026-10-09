import { createHash } from 'node:crypto';
import { unsafePath } from './code-evidence.js';

export type CodeTerms = Readonly<{
  repository: string;
  baseCommit: string;
  testBundleHash: string;
  manifestHash: string;
  testIds: readonly string[];
  tests: readonly Readonly<{ id: string; path: string }>[];
  minMutation: number;
}>;
const KEYS = ['repository', 'baseCommit', 'testBundleHash', 'manifestHash', 'testIds', 'tests', 'minMutation'];
const invalid = () => new RangeError('Invalid code terms');

// T-0159: the frozen terms of a code milestone, checked when the allowance is drafted. The manifest is the buyer's
// {id, path} list sorted by path, and its hash is the same SHA-256 over JSON the Foreman froze; test ids follow it.
export function codeTerms(value: unknown): CodeTerms {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !KEYS.includes(k))) throw invalid();
  const tests = v.tests;
  if (
    typeof v.repository !== 'string' ||
    !/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(v.repository) ||
    typeof v.baseCommit !== 'string' ||
    !/^[a-f0-9]{40}$/.test(v.baseCommit) ||
    typeof v.testBundleHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.testBundleHash) ||
    typeof v.manifestHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.manifestHash) ||
    !Array.isArray(tests) ||
    !tests.length ||
    tests.length > 200 ||
    !tests.every(
      (t) =>
        t &&
        typeof t === 'object' &&
        Object.keys(t).sort().join() === 'id,path' &&
        typeof t.id === 'string' &&
        /^[A-Za-z0-9_.-]{1,100}$/.test(t.id) &&
        typeof t.path === 'string' &&
        !unsafePath(t.path),
    )
  )
    throw invalid();
  const manifest = (tests as { id: string; path: string }[]).map((t) => ({ id: t.id, path: t.path }));
  const ids = manifest.map((t) => t.id);
  const min = v.minMutation ?? 0;
  if (
    new Set(ids).size !== ids.length ||
    new Set(manifest.map((t) => t.path)).size !== manifest.length ||
    manifest.some((t, i) => i > 0 && (manifest[i - 1] as { path: string }).path.localeCompare(t.path) >= 0) ||
    createHash('sha256').update(JSON.stringify(manifest)).digest('hex') !== v.manifestHash ||
    !Array.isArray(v.testIds) ||
    v.testIds.length !== ids.length ||
    v.testIds.some((id, i) => id !== ids[i]) ||
    typeof min !== 'number' ||
    !Number.isFinite(min) ||
    min < 0 ||
    min > 1
  )
    throw invalid();
  return Object.freeze({
    repository: v.repository,
    baseCommit: v.baseCommit,
    testBundleHash: v.testBundleHash,
    manifestHash: v.manifestHash,
    testIds: Object.freeze([...ids]),
    tests: Object.freeze(manifest.map((t) => Object.freeze(t))),
    minMutation: min,
  });
}
