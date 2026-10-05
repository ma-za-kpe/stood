import { CommitPackageError, type CommitPackageInput } from '../ports/commit-package-store.js';
export function commitPackage(input: unknown): CommitPackageInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CommitPackageError('INVALID_PACKAGE');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).sort().join() !== 'base_commit,commit_sha,report_ref,report_sha256,repository' ||
    !Object.values(value).every((v) => typeof v === 'string' && v.length <= 256) ||
    !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(value.repository as string) ||
    !/^[a-f0-9]{40}$/.test(value.base_commit as string) ||
    !/^[a-f0-9]{40}$/.test(value.commit_sha as string) ||
    !/^[a-f0-9]{64}$/.test(value.report_sha256 as string) ||
    !/^[A-Za-z0-9][A-Za-z0-9/_-]*\.json$/.test(value.report_ref as string)
  )
    throw new CommitPackageError('INVALID_PACKAGE');
  return Object.freeze({ ...value }) as CommitPackageInput;
}
