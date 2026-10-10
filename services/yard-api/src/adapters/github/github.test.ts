import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { githubApi } from '../../../test/fakes/github-api.js';
import { GitHubRepositories } from './github.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const make = (api = githubApi(), allowed = ['buyer/project']) => {
  let now = Date.parse('2026-10-09T12:00:00Z');
  const github = new GitHubRepositories({
    appId: '123',
    privateKey: pem,
    installations: [{ id: '42', owner: 'buyer' }],
    allowed,
    fetch: api.fetch,
    clock: () => now,
  });
  return { github, api, advance: (ms: number) => (now += ms) };
};

describe('GitHubRepositories (T-0188)', () => {
  it('issues one-repository tokens, builds on a wo/* branch, opens a pull request and fast-forwards main', async () => {
    const { github, api } = make();
    const read = await github.issue('42', 'buyer/project', 'READ');
    expect(read).toMatchObject({ simulated: false });
    expect(api.calls[0]?.body).toEqual({ repositories: ['project'], permissions: { contents: 'read' } });
    const main = await github.head(read.value, 'buyer/project', 'main');
    const build = await github.issue('42', 'buyer/project', 'BUILD', 'wo/one');
    expect(api.calls.at(-1)?.body).toEqual({ repositories: ['project'], permissions: { contents: 'write' } });
    const pushed = await github.push(build.value, 'buyer/project', 'wo/one', main, { 'src/app.ts': 'built' });
    expect(pushed).toMatchObject({ repository: 'buyer/project', simulated: false });
    expect(await github.head(read.value, 'buyer/project', 'wo/one')).toBe(pushed.commit);
    expect(await github.read(read.value, 'buyer/project', pushed.commit, 'src/app.ts')).toBe('built');
    expect(await github.read(read.value, 'buyer/project', pushed.commit, 'tests/a.test.js')).toBe('signed');
    const again = await github.push(build.value, 'buyer/project', 'wo/one', pushed.commit, { 'src/more.ts': 'x' });
    expect(await github.head(read.value, 'buyer/project', 'wo/one')).toBe(again.commit);
    const archive = await github.archive(read.value, 'buyer/project', again.commit);
    expect(archive).toMatchObject({ format: 'tar.gz', simulated: false });
    expect(archive.bytes.length).toBeGreaterThan(0);
    const maintain = await github.issue('42', 'buyer/project', 'MAINTAIN');
    expect(api.calls.at(-1)?.body).toEqual({
      repositories: ['project'],
      permissions: { contents: 'write', pull_requests: 'write' },
    });
    const merged = await github.merge(maintain.value, 'buyer/project', 'wo/one', again.commit, main);
    expect(merged).toEqual({ repository: 'buyer/project', commit: again.commit, simulated: false });
    expect(api.pulls).toHaveLength(1);
    expect(await github.head(read.value, 'buyer/project', 'main')).toBe(again.commit);
  });

  it('refuses token, repository, branch, signed-test, workflow and path attacks before writing', async () => {
    const api = githubApi({ repos: { project: { 'src/app.ts': 'x' }, other: { 'a.ts': 'y' } } });
    const { github, advance } = make(api, ['buyer/project']);
    await expect(github.issue('42', 'buyer/other', 'READ')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(github.issue('99', 'buyer/project', 'READ')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(github.issue('42', 'buyer/project', 'BUILD', 'main')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(github.issue('42', 'buyer/project', 'READ', 'wo/x')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    const read = await github.issue('42', 'buyer/project', 'READ');
    const build = await github.issue('42', 'buyer/project', 'BUILD', 'wo/one');
    const main = await github.head(read.value, 'buyer/project', 'main');
    const writes = () => api.calls.filter((c) => c.method !== 'GET' && !c.path.includes('access_tokens')).length;
    const before = writes();
    for (const [branch, files] of [
      ['wo/two', { 'src/a.ts': 'x' }],
      ['main', { 'src/a.ts': 'x' }],
      ['wo/one', { 'tests/a.test.js': 'weakened' }],
      ['wo/one', { '.github/workflows/x.yml': 'steal' }],
      ['wo/one', { '../escape.ts': 'x' }],
    ] as const)
      await expect(github.push(build.value, 'buyer/project', branch, main, files)).rejects.toMatchObject({
        code: expect.stringMatching(/FORBIDDEN|INVALID_INPUT/),
      });
    await expect(github.push(read.value, 'buyer/project', 'wo/one', main, { 'src/a.ts': 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      github.push(build.value, 'buyer/project', 'wo/one', 'f'.repeat(40), { 'src/a.ts': 'x' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(writes()).toBe(before);
    await expect(github.merge(build.value, 'buyer/project', 'wo/one', main, main)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(github.read(read.value, 'buyer/project', main, '../x')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(github.head('ghs_unknown', 'buyer/project', 'main')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    advance(3_600_000);
    await expect(github.head(read.value, 'buyer/project', 'main')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('merges only a branch built on the current main, at exactly the expected commits', async () => {
    const { github } = make();
    const read = await github.issue('42', 'buyer/project', 'READ');
    const main = await github.head(read.value, 'buyer/project', 'main');
    const one = await github.issue('42', 'buyer/project', 'BUILD', 'wo/one');
    const two = await github.issue('42', 'buyer/project', 'BUILD', 'wo/two');
    const a = await github.push(one.value, 'buyer/project', 'wo/one', main, { 'src/a.ts': 'a' });
    const b = await github.push(two.value, 'buyer/project', 'wo/two', main, { 'src/b.ts': 'b' });
    const maintain = await github.issue('42', 'buyer/project', 'MAINTAIN');
    await expect(github.merge(maintain.value, 'buyer/project', 'wo/one', b.commit, main)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await github.merge(maintain.value, 'buyer/project', 'wo/one', a.commit, main);
    // wo/two was built on the old main: no silent rebase, no force.
    await expect(github.merge(maintain.value, 'buyer/project', 'wo/two', b.commit, a.commit)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(github.create('42', 'new', {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
