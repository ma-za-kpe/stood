import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { GitHubRepositoryReader } from './repository-reader.js';

const base = 'a'.repeat(40);
const commit = 'b'.repeat(40);
// A minimal ustar archive, as GitHub's tarball endpoint returns (one top-level directory).
function tar(entries: readonly { path: string; content?: string; type?: '0' | '2' | '5'; link?: string }[]) {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.content ?? '', 'utf8');
    const h = Buffer.alloc(512);
    h.write(e.path, 0, 100, 'utf8');
    h.write('0000644\0', 100);
    h.write('0000000\0', 108);
    h.write('0000000\0', 116);
    h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write(e.type ?? '0', 156);
    if (e.link) h.write(e.link, 157);
    h.write('ustar\0', 257);
    h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(h, body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}
function github(over: Partial<Record<string, () => Response>> = {}) {
  const calls: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${url.host}${url.pathname}${url.search} ${new Headers(init?.headers).get('authorization') ?? '-'}`);
    const key = Object.keys(over).find((k) => url.pathname.includes(k));
    if (key) return (over[key] as () => Response)();
    if (url.pathname.endsWith('/contents/tests/a.test.js'))
      return Response.json({ type: 'file', encoding: 'base64', content: Buffer.from('test a').toString('base64') });
    if (url.pathname.endsWith('/contents/link.js')) return Response.json({ type: 'symlink', target: 'x' });
    if (url.pathname.endsWith('/contents/package.json'))
      return Response.json({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(
          JSON.stringify({ dependencies: { 'left-pad': '1.3.0' }, devDependencies: { vitest: '5' } }),
        ).toString('base64'),
      });
    if (url.pathname.includes('/compare/'))
      return Response.json({
        status: 'ahead',
        files: [{ filename: 'src/x.js' }, { filename: 'b.js', previous_filename: 'a.js' }],
      });
    if (url.host === 'codeload.github.com' || url.pathname.includes('/tarball/'))
      return new Response(
        tar([
          { path: 'owner-repo-bbbbbbb/', type: '5' },
          { path: 'owner-repo-bbbbbbb/package.json', content: '{"type":"module"}' },
          { path: 'owner-repo-bbbbbbb/src/x.js', content: 'export const x = 1;' },
          { path: 'owner-repo-bbbbbbb/.git/config', content: 'secret' },
          { path: 'owner-repo-bbbbbbb/node_modules/a/index.js', content: 'vendored' },
          { path: 'owner-repo-bbbbbbb/link.js', type: '2', link: '/etc/passwd' },
        ]),
      );
    return new Response('{}', { status: 404 });
  };
  return { calls, fetch };
}

// T-0159: Stood reads the builder's repository at exact commits, read-only. Anything it cannot read safely is
// unavailable (the package waits); it is never treated as passing.
describe('GitHubRepositoryReader', () => {
  it('reads files, changes, ancestry and dependencies at exact commits', async () => {
    const g = github();
    const reader = new GitHubRepositoryReader({ fetch: g.fetch });
    expect(await reader.files('owner/repo', commit, ['tests/a.test.js', 'missing.js', 'link.js'])).toEqual([
      { path: 'tests/a.test.js', content: 'test a', kind: 'file' },
      { path: 'link.js', content: '', kind: 'symlink' },
    ]);
    expect(await reader.changedPaths('owner/repo', base, commit)).toEqual(['src/x.js', 'b.js', 'a.js']);
    expect(await reader.descends('owner/repo', base, commit)).toBe(true);
    expect(await reader.dependencies('owner/repo', commit)).toEqual({ 'left-pad': '1.3.0', vitest: '5' });
    expect(g.calls[0]).toBe(`api.github.com/repos/owner/repo/contents/tests/a.test.js?ref=${commit} -`);
  });

  it('unpacks the source at a commit, without git data, vendored modules or links', async () => {
    const g = github();
    const files = await new GitHubRepositoryReader({ fetch: g.fetch, token: 'read-only' }).source('owner/repo', commit);
    expect(files).toEqual([
      { path: 'package.json', content: '{"type":"module"}' },
      { path: 'src/x.js', content: 'export const x = 1;' },
    ]);
    expect(g.calls.at(-1)).toBe(`api.github.com/repos/owner/repo/tarball/${commit} Bearer read-only`);
    // Public repositories need no token: the archive comes straight from codeload.
    const open = github();
    await new GitHubRepositoryReader({ fetch: open.fetch }).source('owner/repo', commit);
    expect(open.calls.at(-1)).toBe(`codeload.github.com/owner/repo/tar.gz/${commit} -`);
  });

  it('treats a diverged history as not descending, and a huge or failing compare as unavailable', async () => {
    const diverged = github({ '/compare/': () => Response.json({ status: 'diverged', files: [] }) });
    expect(await new GitHubRepositoryReader({ fetch: diverged.fetch }).descends('owner/repo', base, commit)).toBe(
      false,
    );
    const huge = github({
      '/compare/': () =>
        Response.json({ status: 'ahead', files: Array.from({ length: 300 }, (_, i) => ({ filename: `f${i}` })) }),
    });
    await expect(
      new GitHubRepositoryReader({ fetch: huge.fetch }).changedPaths('owner/repo', base, commit),
    ).rejects.toThrow('REPOSITORY_UNAVAILABLE');
    const down = github({ '/compare/': () => new Response('', { status: 502 }) });
    await expect(
      new GitHubRepositoryReader({ fetch: down.fetch }).descends('owner/repo', base, commit),
    ).rejects.toThrow('REPOSITORY_UNAVAILABLE');
  });

  it('refuses bad repositories, commits and paths before calling GitHub, and oversized or unsafe archives', async () => {
    const g = github();
    const reader = new GitHubRepositoryReader({ fetch: g.fetch, maxSourceBytes: 10 });
    for (const call of [
      () => reader.files('not a repo', commit, ['a']),
      () => reader.files('owner/repo', 'main', ['a']),
      () => reader.files('owner/repo', commit, ['../x']),
      () => reader.source('owner/repo', 'HEAD'),
    ])
      await expect(call()).rejects.toThrow('INVALID_INPUT');
    expect(g.calls).toEqual([]);
    await expect(reader.source('owner/repo', commit)).rejects.toThrow('REPOSITORY_UNAVAILABLE');
    const traversal = github({
      'tar.gz': () => new Response(tar([{ path: 'top/../../etc/x', content: 'x' }])),
    });
    await expect(new GitHubRepositoryReader({ fetch: traversal.fetch }).source('owner/repo', commit)).rejects.toThrow(
      'REPOSITORY_UNAVAILABLE',
    );
  });
});
