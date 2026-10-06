import { describe, expect, it } from 'vitest';
import type { RepoFile, RepositoryReader } from '../ports/repository-reader.js';
import { bundleHash, repositoryChecks } from './code-evidence.js';

const base = 'a'.repeat(40),
  commit = 'b'.repeat(40);
const signedFiles: RepoFile[] = [
  { path: 'tests/booking.test.js', content: 'assert(book())', kind: 'file' },
  { path: 'tests/deposit.test.js', content: 'assert(deposit())', kind: 'file' },
];
const terms = {
  repository: 'buyer/project',
  base,
  commit,
  testBundleHash: bundleHash(signedFiles),
  testPaths: signedFiles.map((f) => f.path),
  dependencyAllowlist: ['hono', 'zod'],
};
const requested: string[] = [];
function reader(
  patch: Partial<{ files: RepoFile[]; changed: string[]; descends: boolean; deps: Record<string, string> }> = {},
) {
  const r: RepositoryReader = {
    files: async (_repo, at, paths) => {
      requested.push(at);
      return (patch.files ?? signedFiles).filter((f) => paths.includes(f.path) || f.kind === 'symlink');
    },
    changedPaths: async () => patch.changed ?? ['src/app.js'],
    descends: async () => patch.descends ?? true,
    dependencies: async () => patch.deps ?? { hono: '4.13.12' },
  };
  return r;
}
const byCode = (results: Awaited<ReturnType<typeof repositoryChecks>>) =>
  Object.fromEntries(results.map((r) => [r.code, [r.status, r.namedField ?? null]]));

describe('Read-only repository evidence (T-0165)', () => {
  it('passes intact signed tests on a new descendant commit with allowlisted dependencies', async () => {
    expect(byCode(await repositoryChecks(reader(), terms))).toEqual({
      signed_tests: ['PASS', null],
      test_integrity: ['PASS', null],
      new_commit: ['PASS', null],
    });
    // Files are always read at the pinned commit under review.
    expect(requested.at(-1)).toBe(commit);
  });
  it.each([
    [
      'a changed signed test',
      { files: [{ ...signedFiles[0]!, content: 'assert(true)' }, signedFiles[1]!] },
      'test_integrity',
      'signed_tests_changed',
    ],
    ['a removed signed test', { files: [signedFiles[0]!] }, 'signed_tests', 'signed_tests_removed'],
    [
      'a symlinked signed test',
      { files: [...signedFiles, { path: 'tests/booking.test.js', content: '', kind: 'symlink' as const }] },
      'test_integrity',
      'unsafe_path',
    ],
    ['a traversal path in the diff', { changed: ['../../etc/passwd'] }, 'test_integrity', 'unsafe_path'],
    ['an edited CI workflow', { changed: ['.github/workflows/ci.yml'] }, 'test_integrity', 'ci_workflow_changed'],
    ['an unlisted dependency', { deps: { hono: '4', leftpad: '1' } }, 'test_integrity', 'dependency_not_allowed'],
    ['a commit that does not descend from base', { descends: false }, 'new_commit', 'no_new_commit'],
  ] as const)('fails with a named field for %s', async (_label, patch, code, field) => {
    expect(byCode(await repositoryChecks(reader(patch as never), terms))[code]).toEqual(['FAIL', field]);
  });
  it('waits instead of passing when the repository is unavailable or the terms are invalid', async () => {
    const down: RepositoryReader = { ...reader(), files: async () => Promise.reject(new Error('rate limited')) };
    expect(Object.values(byCode(await repositoryChecks(down, terms)))).toEqual([
      ['UNCERTAIN', null],
      ['UNCERTAIN', null],
      ['UNCERTAIN', null],
    ]);
    expect((await repositoryChecks(reader(), { ...terms, base: 'main' })).every((r) => r.status === 'UNCERTAIN')).toBe(
      true,
    );
    expect(
      (await repositoryChecks(reader(), { ...terms, testPaths: ['../secret'] })).every((r) => r.status === 'UNCERTAIN'),
    ).toBe(true);
    expect(
      (await repositoryChecks(reader(), { ...terms, commit: base })).find((r) => r.code === 'new_commit')?.status,
    ).toBe('FAIL');
  });
});
