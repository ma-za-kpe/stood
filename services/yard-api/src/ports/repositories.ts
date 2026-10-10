export type RepositoryFiles = Readonly<Record<string, string>>;
export type RepositoryView = Readonly<{ repository: string; commit: string; simulated: boolean }>;
export type RepositoryPermission = 'READ' | 'BUILD' | 'MAINTAIN';
export type RepositoryToken = Readonly<{ value: string; expiresAt: number; simulated: boolean }>;
export interface Repositories {
  create(installation: string, name: string, files: RepositoryFiles): Promise<RepositoryView>;
  issue(
    installation: string,
    repository: string,
    permission: RepositoryPermission,
    branch?: string,
  ): Promise<RepositoryToken>;
  head(token: string, repository: string, branch: string): Promise<string>;
  push(
    token: string,
    repository: string,
    branch: string,
    base: string,
    files: RepositoryFiles,
  ): Promise<RepositoryView>;
  // C4 (#77): Yard's own trusted write of a buyer's frozen tests. A MAINTAIN token fast-forwards main from `base` to a
  // commit that adds only files under tests/. Repeating it with the same files returns the same commit; main having
  // moved, or different tests already there, is a CONFLICT.
  seedTests(token: string, repository: string, base: string, files: RepositoryFiles): Promise<RepositoryView>;
  read(token: string, repository: string, commit: string, path: string): Promise<string>;
  archive(
    token: string,
    repository: string,
    commit: string,
  ): Promise<Readonly<{ bytes: Uint8Array; format: 'fixture-json' | 'tar.gz'; simulated: boolean }>>;
  merge(
    token: string,
    repository: string,
    branch: string,
    expectedHead: string,
    expectedMain: string,
  ): Promise<RepositoryView>;
}
export class RepositoryError extends Error {
  constructor(readonly code: 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT') {
    super(code);
  }
}
