export type RepoFile = Readonly<{ path: string; content: string; kind: 'file' | 'symlink' }>;
// Read-only GitHub access pinned to exact commits. No write, push or merge credentials exist on this port.
export interface RepositoryReader {
  files(repository: string, commit: string, paths: readonly string[]): Promise<readonly RepoFile[]>;
  changedPaths(repository: string, base: string, commit: string): Promise<readonly string[]>;
  descends(repository: string, base: string, commit: string): Promise<boolean>;
  dependencies(repository: string, commit: string): Promise<Readonly<Record<string, string>>>;
}
