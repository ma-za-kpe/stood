import { createHash } from 'node:crypto';
import {
  type Repositories,
  RepositoryError,
  type RepositoryFiles,
  type RepositoryPermission,
} from '../../src/ports/repositories.js';

type Repo = {
  owner: string;
  main: string;
  branches: Map<string, { head: string; base: string }>;
  commits: Map<string, RepositoryFiles>;
};
const segment = (s: string) =>
  typeof s === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(s) && !['.', '..'].includes(s);
const branchName = (s: string) => typeof s === 'string' && /^wo\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(s);
const pathName = (s: string) =>
  typeof s === 'string' &&
  s.length <= 512 &&
  /^[A-Za-z0-9_./-]+$/.test(s) &&
  s.split('/').every((part) => !!part && part !== '.' && part !== '..');
function tree(files: RepositoryFiles): RepositoryFiles {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new RepositoryError('INVALID_INPUT');
  const entries = Object.entries(files);
  if (
    entries.length > 1000 ||
    entries.some(([path, value]) => !pathName(path) || typeof value !== 'string' || Buffer.byteLength(value) > 65536) ||
    entries.reduce((n, [, value]) => n + Buffer.byteLength(value), 0) > 1048576
  )
    throw new RepositoryError('INVALID_INPUT');
  return Object.freeze(Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b))));
}
// An independent in-memory port model, not Git's object format or the GitHub wire protocol.
export class FakeRepositories implements Repositories {
  private owners = new Map<string, string>();
  private repos = new Map<string, Repo>();
  private tokens = new Map<
    string,
    { repository: string; permission: RepositoryPermission; expiresAt: number; branch?: string }
  >();
  private sequence = 0;
  private lastAt = -1;
  constructor(
    private readonly clock: () => number,
    installations: readonly { id: string; owner: string }[],
  ) {
    for (const { id, owner } of installations) {
      if (!segment(id) || !segment(owner) || this.owners.has(id)) throw new RepositoryError('INVALID_INPUT');
      this.owners.set(id, owner);
    }
  }
  private now() {
    const at = this.clock();
    if (!Number.isSafeInteger(at) || at < 0 || at < this.lastAt || at > Number.MAX_SAFE_INTEGER - 3600000)
      throw new RepositoryError('INVALID_INPUT');
    this.lastAt = at;
    return at;
  }
  private authorize(value: string, repository: string) {
    const token = this.tokens.get(value);
    if (!token || token.repository !== repository || this.now() >= token.expiresAt)
      throw new RepositoryError('FORBIDDEN');
    const repo = this.repos.get(repository);
    if (!repo) throw new RepositoryError('NOT_FOUND');
    return { token, repo };
  }
  private commit(repository: string, parent: string, files: RepositoryFiles) {
    return createHash('sha1')
      .update(JSON.stringify([repository, parent, files]))
      .digest('hex');
  }
  async create(installation: string, name: string, files: RepositoryFiles) {
    const owner = this.owners.get(installation);
    if (!owner) throw new RepositoryError('FORBIDDEN');
    if (!segment(name)) throw new RepositoryError('INVALID_INPUT');
    const repository = `${owner}/${name}`;
    if (this.repos.has(repository)) throw new RepositoryError('CONFLICT');
    const contents = tree(files);
    const commit = this.commit(repository, '', contents);
    this.repos.set(repository, { owner, main: commit, branches: new Map(), commits: new Map([[commit, contents]]) });
    return { repository, commit, simulated: true };
  }
  async issue(installation: string, repository: string, permission: RepositoryPermission, branch?: string) {
    const repo = this.repos.get(repository);
    const owner = this.owners.get(installation);
    if (!owner || repo?.owner !== owner) throw new RepositoryError('FORBIDDEN');
    if (
      !['READ', 'BUILD', 'MAINTAIN'].includes(permission) ||
      (permission === 'BUILD' ? !branchName(branch ?? '') : branch !== undefined)
    )
      throw new RepositoryError('INVALID_INPUT');
    const value = `SIM-GITHUB-TOKEN-${++this.sequence}`;
    const expiresAt = this.now() + 3600000;
    this.tokens.set(value, { repository, permission, expiresAt, ...(branch ? { branch } : {}) });
    return { value, expiresAt, simulated: true };
  }
  async head(value: string, repository: string, branch: string) {
    const { repo } = this.authorize(value, repository);
    const head = branch === 'main' ? repo.main : repo.branches.get(branch)?.head;
    if (!head) throw new RepositoryError('NOT_FOUND');
    return head;
  }
  async push(value: string, repository: string, branch: string, base: string, files: RepositoryFiles) {
    const { token, repo } = this.authorize(value, repository);
    if (!branchName(branch) || token.permission !== 'BUILD' || token.branch !== branch)
      throw new RepositoryError('FORBIDDEN');
    const changes = tree(files);
    if (Object.keys(changes).some((path) => path.startsWith('tests/') || path.startsWith('.github/')))
      throw new RepositoryError('FORBIDDEN');
    const previous = repo.branches.get(branch);
    if ((previous?.head ?? repo.main) !== base) throw new RepositoryError('CONFLICT');
    const contents = repo.commits.get(base);
    if (!contents) throw new RepositoryError('NOT_FOUND');
    const next = tree(Object.fromEntries([...Object.entries(contents), ...Object.entries(changes)]));
    const commit = this.commit(repository, base, next);
    repo.commits.set(commit, next);
    repo.branches.set(branch, { head: commit, base: previous?.base ?? base });
    return { repository, commit, simulated: true };
  }
  async seedTests(value: string, repository: string, base: string, files: RepositoryFiles) {
    const { token, repo } = this.authorize(value, repository);
    if (token.permission !== 'MAINTAIN') throw new RepositoryError('FORBIDDEN');
    const changes = tree(files);
    const paths = Object.keys(changes);
    if (!paths.length || paths.some((p) => !p.startsWith('tests/')) || !/^[a-f0-9]{40}$/.test(base))
      throw new RepositoryError('INVALID_INPUT');
    const contents = repo.commits.get(base);
    if (!contents) throw new RepositoryError('NOT_FOUND');
    const next = tree(Object.fromEntries([...Object.entries(contents), ...Object.entries(changes)]));
    const commit = this.commit(repository, base, next);
    if (repo.main === commit) return { repository, commit, simulated: true };
    if (repo.main !== base) throw new RepositoryError('CONFLICT');
    repo.commits.set(commit, next);
    repo.main = commit;
    return { repository, commit, simulated: true };
  }
  async read(value: string, repository: string, commit: string, path: string) {
    const { repo } = this.authorize(value, repository);
    if (!/^[a-f0-9]{40}$/.test(commit) || !pathName(path)) throw new RepositoryError('INVALID_INPUT');
    const files = repo.commits.get(commit);
    if (!files || !Object.hasOwn(files, path)) throw new RepositoryError('NOT_FOUND');
    const content = files[path];
    if (content === undefined) throw new RepositoryError('NOT_FOUND');
    return content;
  }
  async archive(value: string, repository: string, commit: string) {
    const { repo } = this.authorize(value, repository);
    const files = repo.commits.get(commit);
    if (!files) throw new RepositoryError('NOT_FOUND');
    return {
      bytes: new Uint8Array(Buffer.from(JSON.stringify({ repository, commit, files, simulated: true }))),
      format: 'fixture-json' as const,
      simulated: true,
    };
  }
  async merge(value: string, repository: string, branch: string, expectedHead: string, expectedMain: string) {
    const { token, repo } = this.authorize(value, repository);
    if (token.permission !== 'MAINTAIN') throw new RepositoryError('FORBIDDEN');
    const source = repo.branches.get(branch);
    if (!source || source.head !== expectedHead || repo.main !== expectedMain || source.base !== repo.main)
      throw new RepositoryError('CONFLICT');
    repo.main = source.head;
    return { repository, commit: repo.main, simulated: true };
  }
}
