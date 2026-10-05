import { describe, expect, it } from 'vitest';
import { FakeRepositories } from './fakes/github.js';

describe('Scoped GitHub repository fake', () => {
  it('creates in the installed buyer account, preserves commits and merges only with maintainer authority', async () => {
    const github = new FakeRepositories(() => 0, [{ id: 'installation-1', owner: 'buyer' }]);
    const repo = await github.create('installation-1', 'project', {
      'tests/contract.ts': 'signed tests',
      'src/app.ts': 'empty',
    });
    const build = await github.issue('installation-1', repo.repository, 'BUILD', 'wo/one');
    const read = await github.issue('installation-1', repo.repository, 'READ');
    const maintain = await github.issue('installation-1', repo.repository, 'MAINTAIN');
    const commit = await github.push(build.value, repo.repository, 'wo/one', repo.commit, { 'src/app.ts': 'built' });
    expect(await github.read(read.value, repo.repository, repo.commit, 'src/app.ts')).toBe('empty');
    expect(await github.read(read.value, repo.repository, commit.commit, 'src/app.ts')).toBe('built');
    expect(await github.read(read.value, repo.repository, commit.commit, 'tests/contract.ts')).toBe('signed tests');
    await expect(
      github.merge(build.value, repo.repository, 'wo/one', commit.commit, repo.commit),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const merged = await github.merge(maintain.value, repo.repository, 'wo/one', commit.commit, repo.commit);
    expect(merged).toEqual(commit);
    const archive = await github.archive(read.value, repo.repository, repo.commit);
    expect(archive).toMatchObject({ simulated: true, format: 'fixture-json' });
    expect(JSON.parse(Buffer.from(archive.bytes).toString()).files['src/app.ts']).toBe('empty');
  });
  it('rejects token, repository, protected-branch, test-file and path attacks without a write', async () => {
    let at = 0;
    const github = new FakeRepositories(() => at, [{ id: 'i', owner: 'buyer' }]);
    const repo = await github.create('i', 'project', { 'src/app.ts': 'empty' });
    const other = await github.create('i', 'other', {});
    const token = await github.issue('i', repo.repository, 'BUILD', 'wo/one');
    await expect(github.issue('i', 'stranger/project', 'READ')).rejects.toThrow();
    await expect(github.create('unknown', 'project', {})).rejects.toThrow();
    await expect(github.read(token.value, other.repository, other.commit, 'src/app.ts')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    for (const branch of ['main', 'wo/two', 'wo/../main'])
      await expect(
        github.push(token.value, repo.repository, branch, repo.commit, { 'src/app.ts': 'bad' }),
      ).rejects.toThrow();
    for (const path of [
      '../secret',
      '/secret',
      'src/../secret',
      'src\\secret',
      '%2e%2e/secret',
      'tests/contract.ts',
      '.github/workflows/build.yml',
    ])
      await expect(
        github.push(token.value, repo.repository, 'wo/one', repo.commit, { [path]: 'bad' }),
      ).rejects.toThrow();
    expect(await github.head(token.value, repo.repository, 'main')).toBe(repo.commit);
    at = token.expiresAt;
    await expect(github.read(token.value, repo.repository, repo.commit, 'src/app.ts')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
  it('enforces compare-and-swap and never treats inherited object properties as files', async () => {
    const github = new FakeRepositories(() => 0, [{ id: 'i', owner: 'buyer' }]);
    const repo = await github.create('i', 'project', {});
    const token = await github.issue('i', repo.repository, 'BUILD', 'wo/one');
    const first = await github.push(token.value, repo.repository, 'wo/one', repo.commit, { 'src/a': 'one' });
    await expect(
      github.push(token.value, repo.repository, 'wo/one', repo.commit, { 'src/a': 'two' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await github.head(token.value, repo.repository, 'wo/one')).toBe(first.commit);
    await expect(github.read(token.value, repo.repository, first.commit, 'constructor')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
