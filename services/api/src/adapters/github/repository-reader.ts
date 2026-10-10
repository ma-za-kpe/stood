import { gunzipSync } from 'node:zlib';
import type { RepoFile, RepositoryReader } from '../../ports/repository-reader.js';

type Config = Readonly<{
  // Optional read-only token for private repositories. Public ones need none. Stood has no write access anywhere.
  token?: string;
  fetch?: typeof globalThis.fetch;
  maxSourceBytes?: number;
  maxFiles?: number;
}>;
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
const SHA = /^[a-f0-9]{40}$/;
const safe = (path: string) =>
  typeof path === 'string' &&
  path.length > 0 &&
  path.length <= 400 &&
  !path.startsWith('/') &&
  !/[\\\0]/.test(path) &&
  path.split('/').every((part) => part && part !== '.' && part !== '..');
const unavailable = () => new Error('REPOSITORY_UNAVAILABLE');

// T-0159: Stood's read-only view of a builder's repository, pinned to exact commits (GitHub REST and the commit
// tarball). Anything it cannot read safely throws REPOSITORY_UNAVAILABLE, so the package waits; it never passes.
export class GitHubRepositoryReader implements RepositoryReader {
  private readonly http: typeof globalThis.fetch;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  constructor(private readonly config: Config = {}) {
    this.http = config.fetch ?? fetch;
    this.maxBytes = config.maxSourceBytes ?? 50_000_000;
    this.maxFiles = config.maxFiles ?? 5000;
  }
  private check(repository: string, ...commits: string[]) {
    if (!REPO.test(repository) || !commits.every((c) => SHA.test(c))) throw new Error('INVALID_INPUT');
  }
  private async get(url: string) {
    let response: Response;
    try {
      response = await this.http(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(this.config.token ? { Authorization: `Bearer ${this.config.token}` } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw unavailable();
    }
    return response;
  }
  private async json(url: string): Promise<Record<string, unknown>> {
    const response = await this.get(url);
    if (!response.ok) throw unavailable();
    return (await response.json()) as Record<string, unknown>;
  }

  async files(repository: string, commit: string, paths: readonly string[]): Promise<readonly RepoFile[]> {
    this.check(repository, commit);
    if (!paths.every(safe)) throw new Error('INVALID_INPUT');
    const out: RepoFile[] = [];
    for (const path of paths) {
      const response = await this.get(
        `https://api.github.com/repos/${repository}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${commit}`,
      );
      if (response.status === 404) continue;
      if (!response.ok) throw unavailable();
      const body = (await response.json()) as { type?: string; encoding?: string; content?: string };
      if (body.type === 'symlink') out.push({ path, content: '', kind: 'symlink' });
      else if (body.type === 'file' && body.encoding === 'base64' && typeof body.content === 'string')
        out.push({ path, content: Buffer.from(body.content, 'base64').toString('utf8'), kind: 'file' });
      else throw unavailable();
    }
    return out;
  }

  private async compare(repository: string, base: string, commit: string) {
    this.check(repository, base, commit);
    const body = await this.json(`https://api.github.com/repos/${repository}/compare/${base}...${commit}`);
    const files = Array.isArray(body.files)
      ? (body.files as { filename?: unknown; previous_filename?: unknown }[])
      : null;
    // GitHub lists at most 300 changed files; a longer change cannot be checked completely, so it waits.
    if (!files || files.length >= 300 || typeof body.status !== 'string') throw unavailable();
    return { status: body.status, files };
  }
  async changedPaths(repository: string, base: string, commit: string): Promise<readonly string[]> {
    const { files } = await this.compare(repository, base, commit);
    return files.flatMap((f) =>
      [f.filename, f.previous_filename].filter((p): p is string => typeof p === 'string' && p.length > 0),
    );
  }
  async descends(repository: string, base: string, commit: string): Promise<boolean> {
    const { status } = await this.compare(repository, base, commit);
    return status === 'ahead' || status === 'identical';
  }
  async dependencies(repository: string, commit: string): Promise<Readonly<Record<string, string>>> {
    const [manifest] = await this.files(repository, commit, ['package.json']);
    if (!manifest) return {};
    if (manifest.kind !== 'file') throw unavailable();
    try {
      const pkg = JSON.parse(manifest.content) as Record<string, unknown>;
      const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) } as Record<string, unknown>;
      return Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, String(v)]));
    } catch {
      throw unavailable();
    }
  }

  // The whole repository at one commit, as text files: no .git data, no vendored node_modules, no links.
  async source(repository: string, commit: string): Promise<readonly Readonly<{ path: string; content: string }>[]> {
    this.check(repository, commit);
    const response = await this.get(
      this.config.token
        ? `https://api.github.com/repos/${repository}/tarball/${commit}`
        : `https://codeload.github.com/${repository}/tar.gz/${commit}`,
    );
    if (!response.ok) throw unavailable();
    const packed = Buffer.from(await response.arrayBuffer());
    if (packed.length > this.maxBytes) throw unavailable();
    let archive: Buffer;
    try {
      archive = gunzipSync(packed, { maxOutputLength: this.maxBytes });
    } catch {
      throw unavailable();
    }
    const files: { path: string; content: string }[] = [];
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let offset = 0; offset + 512 <= archive.length; ) {
      const header = archive.subarray(offset, offset + 512);
      if (header.every((b) => b === 0)) break;
      const field = (start: number, length: number) =>
        header
          .subarray(start, start + length)
          .toString('utf8')
          .replace(/\0.*$/s, '');
      const prefix = field(345, 155);
      const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
      const size = Number.parseInt(field(124, 12).trim() || '0', 8);
      const type = field(156, 1) || '0';
      if (!Number.isSafeInteger(size) || size < 0) throw unavailable();
      const body = archive.subarray(offset + 512, offset + 512 + size);
      offset += 512 + Math.ceil(size / 512) * 512;
      // GitHub's archives hold one top-level directory, and pax headers that carry metadata only.
      if (type === 'g' || type === 'x') continue;
      const path = name.split('/').slice(1).join('/').replace(/\/$/, '');
      if (!path) continue;
      if (!safe(path)) throw unavailable();
      if (type !== '0' && type !== '') continue;
      if (path.split('/').some((part) => part === '.git' || part === 'node_modules')) continue;
      if (files.length >= this.maxFiles) throw unavailable();
      try {
        files.push({ path, content: decoder.decode(body) });
      } catch {
        // Binary files are not part of a test run: skipped, never decoded wrongly.
      }
    }
    return files;
  }
}
