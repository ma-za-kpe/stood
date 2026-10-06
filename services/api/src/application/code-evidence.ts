import { createHash } from 'node:crypto';
import type { CheckResult } from '../domain/decision.js';
import type { RepositoryReader } from '../ports/repository-reader.js';

export type SignedTerms = Readonly<{
  repository: string;
  base: string;
  commit: string;
  testBundleHash: string;
  testPaths: readonly string[];
  dependencyAllowlist: readonly string[];
}>;
// Same identity the Foreman froze: SHA-256 over the {path, content} list sorted by path.
export function bundleHash(files: readonly { path: string; content: string }[]): string {
  const sorted = [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => ({ path: f.path, content: f.content }));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
export function unsafePath(path: string): boolean {
  return (
    !path ||
    path.length > 400 ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some((part) => part === '..' || part === '.' || part === '')
  );
}
const rule = (code: string, status: CheckResult['status'], reason: string, namedField?: string): CheckResult =>
  namedField ? { code, source: 'RULE', status, reason, namedField } : { code, source: 'RULE', status, reason };
// T-0165: deterministic findings from a read-only repository. Unavailable evidence waits; it never passes.
export async function repositoryChecks(reader: RepositoryReader, terms: SignedTerms): Promise<CheckResult[]> {
  const waitAll = (reason: string) =>
    ['signed_tests', 'test_integrity', 'new_commit'].map((code) => rule(code, 'UNCERTAIN', reason));
  if (!/^[a-f0-9]{40}$/.test(terms.base) || !/^[a-f0-9]{40}$/.test(terms.commit) || terms.testPaths.some(unsafePath))
    return waitAll('invalid_terms');
  try {
    const [files, changed, descends, deps] = await Promise.all([
      reader.files(terms.repository, terms.commit, terms.testPaths),
      reader.changedPaths(terms.repository, terms.base, terms.commit),
      reader.descends(terms.repository, terms.base, terms.commit),
      reader.dependencies(terms.repository, terms.commit),
    ]);
    const results: CheckResult[] = [];
    const present = files.filter((f) => f.kind === 'file' && terms.testPaths.includes(f.path));
    results.push(
      present.length === terms.testPaths.length
        ? rule('signed_tests', 'PASS', 'signed_tests_present')
        : rule('signed_tests', 'FAIL', 'signed_tests_removed', 'signed_tests_removed'),
    );
    const integrity =
      files.some((f) => f.kind !== 'file' || unsafePath(f.path)) || changed.some(unsafePath)
        ? 'unsafe_path'
        : bundleHash(present) !== terms.testBundleHash
          ? 'signed_tests_changed'
          : changed.some((p) => p.startsWith('.github/workflows/'))
            ? 'ci_workflow_changed'
            : Object.keys(deps).some((name) => !terms.dependencyAllowlist.includes(name))
              ? 'dependency_not_allowed'
              : null;
    results.push(
      integrity
        ? rule('test_integrity', 'FAIL', integrity, integrity)
        : rule('test_integrity', 'PASS', 'signed_tests_intact'),
    );
    results.push(
      terms.commit !== terms.base && descends
        ? rule('new_commit', 'PASS', 'new_commit_on_base')
        : rule('new_commit', 'FAIL', 'no_new_commit', 'no_new_commit'),
    );
    return results;
  } catch {
    return waitAll('repository_unavailable');
  }
}
