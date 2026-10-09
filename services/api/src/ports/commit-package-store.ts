export type CommitPackageInput = Readonly<{
  repository: string;
  base_commit: string;
  commit_sha: string;
  report_ref: string;
  report_sha256: string;
}>;
export type StoredCommitPackage = Readonly<{
  id: string;
  trancheId: string;
  status: 'QUEUED';
  waitingFor: 'HOLD' | 'RENEWAL' | 'RUNNER';
  metadata: CommitPackageInput;
  createdAt: string;
}>;
export interface CommitPackageStore {
  submit(
    platformId: string,
    trancheId: string,
    key: string,
    fingerprint: string,
    input: CommitPackageInput,
  ): Promise<StoredCommitPackage>;
  get(platformId: string, trancheId: string, id: string): Promise<StoredCommitPackage | null>;
  // T-0189: the package Stood is judging now (the latest submitted for the tranche).
  latest(platformId: string, trancheId: string): Promise<StoredCommitPackage | null>;
}
export class CommitPackageError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID_PACKAGE') {
    super(code);
  }
}
