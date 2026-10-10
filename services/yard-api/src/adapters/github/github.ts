import { createSign } from 'node:crypto';
import {
  type Repositories,
  RepositoryError,
  type RepositoryFiles,
  type RepositoryPermission,
  type RepositoryView,
} from '../../ports/repositories.js';

// T-0188: the Yard Builder GitHub App behind the Repositories port. GitHub scopes each installation token to one
// repository and its permissions; this adapter adds Yard's rules on top and checks them before any write: build
// tokens belong to one wo/* branch, pushes never touch signed tests or workflows, and main only moves by a
// non-forced fast-forward from a branch built on it, through an open pull request.
type Config = Readonly<{
  appId: string;
  privateKey: string;
  installations: readonly Readonly<{ id: string; owner: string }>[];
  // Repositories Yard may touch (owner/name). Anything else is refused even if the App can see it.
  allowed: readonly string[];
  fetch?: typeof globalThis.fetch;
  clock?: () => number;
  api?: string;
}>;
type Grant = Readonly<{ repository: string; permission: RepositoryPermission; branch?: string; expiresAt: number }>;
const HOUR = 3_600_000;
const segment = (s: string) => /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(s) && !['.', '..'].includes(s);
const branchName = (s: string) => /^wo\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(s);
const pathName = (s: string) =>
  typeof s === 'string' &&
  s.length <= 512 &&
  /^[A-Za-z0-9_./-]+$/.test(s) &&
  s.split('/').every((part) => !!part && part !== '.' && part !== '..');
const sha = (s: string) => /^[a-f0-9]{40}$/.test(s);
const permissions = {
  READ: { contents: 'read' },
  BUILD: { contents: 'write' },
  MAINTAIN: { contents: 'write', pull_requests: 'write' },
} as const;

export class GitHubRepositories implements Repositories {
  private readonly grants = new Map<string, Grant>();
  private readonly clock: () => number;
  private readonly http: typeof globalThis.fetch;
  private readonly api: string;
  constructor(private readonly config: Config) {
    if (!/^\d+$/.test(config.appId) || !config.privateKey.includes('PRIVATE KEY'))
      throw new Error('GitHub App credentials are missing');
    this.clock = config.clock ?? Date.now;
    this.http = config.fetch ?? fetch;
    this.api = config.api ?? 'https://api.github.com';
  }

  private jwt(): string {
    const now = Math.floor(this.clock() / 1000);
    const part = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: this.config.appId })}`;
    return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(this.config.privateKey, 'base64url')}`;
  }
  private async call(
    auth: string,
    method: string,
    path: string,
    body?: unknown,
    accept = 'application/vnd.github+json',
  ) {
    try {
      return await this.http(`${this.api}${path}`, {
        method,
        headers: {
          Authorization: auth,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error('REPOSITORY_UNAVAILABLE');
    }
  }
  private grant(token: string, repository: string): Grant {
    const grant = this.grants.get(token);
    if (!grant || grant.repository !== repository || this.clock() >= grant.expiresAt)
      throw new RepositoryError('FORBIDDEN');
    return grant;
  }
  private async json(response: Response, missing: RepositoryError['code'] = 'NOT_FOUND') {
    if (response.status === 404) throw new RepositoryError(missing);
    if (response.status === 401 || response.status === 403) throw new RepositoryError('FORBIDDEN');
    if (response.status === 409 || response.status === 422) throw new RepositoryError('CONFLICT');
    if (!response.ok) throw new Error('REPOSITORY_UNAVAILABLE');
    return response.status === 204 ? {} : ((await response.json()) as Record<string, unknown>);
  }
  private async ref(token: string, repository: string, branch: string): Promise<string | null> {
    const response = await this.call(`token ${token}`, 'GET', `/repos/${repository}/git/ref/heads/${branch}`);
    if (response.status === 404) return null;
    const body = await this.json(response);
    return String((body.object as { sha?: unknown } | undefined)?.sha ?? '');
  }

  async create(_installation: string, _name: string, _files: RepositoryFiles): Promise<RepositoryView> {
    // An App installed on a personal account cannot create repositories there; the buyer creates and installs.
    throw new RepositoryError('FORBIDDEN');
  }

  async issue(installation: string, repository: string, permission: RepositoryPermission, branch?: string) {
    const owner = this.config.installations.find((i) => i.id === installation)?.owner;
    const [repoOwner = '', name = ''] = repository.split('/');
    if (!owner || repoOwner !== owner || !segment(name) || !this.config.allowed.includes(repository))
      throw new RepositoryError('FORBIDDEN');
    if (!(permission in permissions) || (permission === 'BUILD' ? !branchName(branch ?? '') : branch !== undefined))
      throw new RepositoryError('INVALID_INPUT');
    const body = await this.json(
      await this.call(`Bearer ${this.jwt()}`, 'POST', `/app/installations/${installation}/access_tokens`, {
        repositories: [name],
        permissions: permissions[permission],
      }),
      'FORBIDDEN',
    );
    const value = String(body.token ?? '');
    const expiresAt = Math.min(Date.parse(String(body.expires_at)) || 0, this.clock() + HOUR);
    if (!value || !(expiresAt > this.clock())) throw new Error('REPOSITORY_UNAVAILABLE');
    this.grants.set(value, { repository, permission, expiresAt, ...(branch ? { branch } : {}) });
    return { value, expiresAt, simulated: false };
  }

  async head(token: string, repository: string, branch: string) {
    this.grant(token, repository);
    if (branch !== 'main' && !branchName(branch)) throw new RepositoryError('INVALID_INPUT');
    const head = await this.ref(token, repository, branch);
    if (!head) throw new RepositoryError('NOT_FOUND');
    return head;
  }

  async push(token: string, repository: string, branch: string, base: string, files: RepositoryFiles) {
    const grant = this.grant(token, repository);
    if (!branchName(branch) || grant.permission !== 'BUILD' || grant.branch !== branch)
      throw new RepositoryError('FORBIDDEN');
    const entries = Object.entries(files ?? {});
    if (
      !entries.length ||
      entries.length > 1000 ||
      entries.some(([path, value]) => !pathName(path) || typeof value !== 'string' || Buffer.byteLength(value) > 65536)
    )
      throw new RepositoryError('INVALID_INPUT');
    if (entries.some(([path]) => path.startsWith('tests/') || path.startsWith('.github/')))
      throw new RepositoryError('FORBIDDEN');
    if (!sha(base)) throw new RepositoryError('INVALID_INPUT');
    const existing = await this.ref(token, repository, branch);
    const current = existing ?? (await this.ref(token, repository, 'main'));
    if (current !== base) throw new RepositoryError('CONFLICT');
    // Every check has passed; only now write.
    const auth = `token ${token}`;
    const parent = await this.json(await this.call(auth, 'GET', `/repos/${repository}/git/commits/${base}`));
    const tree = await this.json(
      await this.call(auth, 'POST', `/repos/${repository}/git/trees`, {
        base_tree: (parent.tree as { sha: string }).sha,
        tree: entries.map(([path, content]) => ({ path, mode: '100644', type: 'blob', content })),
      }),
    );
    const commit = await this.json(
      await this.call(auth, 'POST', `/repos/${repository}/git/commits`, {
        message: `yard: update ${branch}`,
        tree: tree.sha,
        parents: [base],
      }),
    );
    const next = String(commit.sha);
    await this.json(
      existing
        ? await this.call(auth, 'PATCH', `/repos/${repository}/git/refs/heads/${branch}`, { sha: next, force: false })
        : await this.call(auth, 'POST', `/repos/${repository}/git/refs`, { ref: `refs/heads/${branch}`, sha: next }),
      'CONFLICT',
    );
    return { repository, commit: next, simulated: false };
  }

  async read(token: string, repository: string, commit: string, path: string) {
    this.grant(token, repository);
    if (!sha(commit) || !pathName(path)) throw new RepositoryError('INVALID_INPUT');
    const response = await this.call(
      `token ${token}`,
      'GET',
      `/repos/${repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`,
      undefined,
      'application/vnd.github.raw+json',
    );
    if (response.status === 404) throw new RepositoryError('NOT_FOUND');
    await (response.ok ? Promise.resolve() : this.json(response));
    return response.text();
  }

  async archive(token: string, repository: string, commit: string) {
    this.grant(token, repository);
    if (!sha(commit)) throw new RepositoryError('INVALID_INPUT');
    const response = await this.call(`token ${token}`, 'GET', `/repos/${repository}/tarball/${commit}`);
    if (!response.ok) await this.json(response);
    return { bytes: new Uint8Array(await response.arrayBuffer()), format: 'tar.gz' as const, simulated: false };
  }

  async merge(token: string, repository: string, branch: string, expectedHead: string, expectedMain: string) {
    const grant = this.grant(token, repository);
    if (grant.permission !== 'MAINTAIN') throw new RepositoryError('FORBIDDEN');
    if (!branchName(branch) || !sha(expectedHead) || !sha(expectedMain)) throw new RepositoryError('INVALID_INPUT');
    const [head, main] = [await this.ref(token, repository, branch), await this.ref(token, repository, 'main')];
    if (head !== expectedHead || main !== expectedMain) throw new RepositoryError('CONFLICT');
    const auth = `token ${token}`;
    const compare = await this.json(await this.call(auth, 'GET', `/repos/${repository}/compare/${main}...${head}`));
    if (compare.status !== 'ahead' || compare.behind_by !== 0) throw new RepositoryError('CONFLICT');
    const owner = repository.split('/')[0];
    const open = await this.call(auth, 'GET', `/repos/${repository}/pulls?state=open&head=${owner}:${branch}`);
    if (!((await this.json(open)) as unknown as unknown[]).length)
      await this.json(
        await this.call(auth, 'POST', `/repos/${repository}/pulls`, {
          title: `Yard: ${branch}`,
          head: branch,
          base: 'main',
          body: 'Work accepted by Stood. Main fast-forwards to the exact checked commit.',
        }),
      );
    await this.json(
      await this.call(auth, 'PATCH', `/repos/${repository}/git/refs/heads/main`, { sha: expectedHead, force: false }),
      'CONFLICT',
    );
    return { repository, commit: expectedHead, simulated: false };
  }
}
