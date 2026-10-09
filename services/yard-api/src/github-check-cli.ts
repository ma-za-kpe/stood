import { GitHubRepositories } from './adapters/github/github.js';
import { RepositoryError } from './ports/repositories.js';

// Operator tool (T-0188): qualify the Yard Builder App against the sandbox repository. It reads main, builds on a
// throwaway wo/qualify-* branch, reads the file back, fetches the tarball, checks a signed-test write is refused,
// and deletes the branch. It never touches main and prints no token or key.
const repository = process.env.YARD_SANDBOX_REPOSITORY ?? 'ma-za-kpe/yard-sandbox';
const installation = process.env.GITHUB_APP_INSTALLATION_ID ?? '';
const privateKey = Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8');
const github = new GitHubRepositories({
  appId: process.env.GITHUB_APP_ID ?? '',
  privateKey,
  installations: [{ id: installation, owner: repository.split('/')[0] ?? '' }],
  allowed: [repository],
});
const step = (name: string, detail = '') => process.stdout.write(`ok  ${name}${detail ? `: ${detail}` : ''}\n`);
const branch = `wo/qualify-${Date.now()}`;
const read = await github.issue(installation, repository, 'READ');
const main = await github.head(read.value, repository, 'main');
step('read main', main.slice(0, 12));
const build = await github.issue(installation, repository, 'BUILD', branch);
const path = `yard-qualify/${branch.slice(3)}.md`;
const pushed = await github.push(build.value, repository, branch, main, {
  [path]: 'Yard qualification run. Safe to delete.\n',
});
step('push to its own wo/* branch', pushed.commit.slice(0, 12));
if ((await github.head(read.value, repository, branch)) !== pushed.commit) throw new Error('branch head mismatch');
if ((await github.read(read.value, repository, pushed.commit, path)) !== 'Yard qualification run. Safe to delete.\n')
  throw new Error('read-back mismatch');
step('read the file back at that commit');
const archive = await github.archive(read.value, repository, pushed.commit);
step('fetch the tarball', `${archive.bytes.length} bytes`);
try {
  await github.push(build.value, repository, branch, pushed.commit, { 'tests/weakened.test.js': 'x' });
  throw new Error('signed-test write was not refused');
} catch (error) {
  if (!(error instanceof RepositoryError && error.code === 'FORBIDDEN')) throw error;
  step('refuse a write to tests/ before calling GitHub');
}
const removed = await fetch(`https://api.github.com/repos/${repository}/git/refs/heads/${branch}`, {
  method: 'DELETE',
  headers: { Authorization: `token ${build.value}`, Accept: 'application/vnd.github+json' },
});
if (removed.status !== 204) throw new Error(`branch cleanup failed (${removed.status})`);
step('delete the qualification branch');
