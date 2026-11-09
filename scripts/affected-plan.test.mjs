import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./affected-plan.mjs', import.meta.url));
const runner = fileURLToPath(new URL('./check-product-affected', import.meta.url));
const isolatedGitEnvironment = { ...process.env };
for (const key of Object.keys(isolatedGitEnvironment)) {
  if (key.startsWith('GIT_')) delete isolatedGitEnvironment[key];
}
const plan = (...paths) => {
  const result = spawnSync(process.execPath, [script, ...paths], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

test('a Yard web style edit selects affected workspace tasks', () => {
  assert.match(plan('apps/yard-web/src/theme.css'), /^affected::/);
});

test('an API application edit selects affected workspace tasks', () => {
  assert.match(plan('services/api/src/application/funding.ts'), /^affected::/);
});

test('a shared workspace contract edit selects dependent workspace tasks', () => {
  assert.match(plan('packages/yard-contracts/src/intake.ts'), /^affected::/);
});

test('SDK source and contract tests always run SDK qualification', () => {
  for (const path of [
    'sdk/typescript/src/controllers/api.ts',
    'apimatic/src/sdk-source-tree/.typescript/src/index.ts',
    'services/api/test/sdk/apimatic-sdk.sdk.test.ts',
  ]) {
    assert.match(plan(path), /^full::generated SDK or SDK qualification changed/, path);
  }
});

test('non-workspace executable and site paths fail safe to the full gate', () => {
  for (const path of ['site/yard/tokens.css', 'tools/new-check/run.mjs', 'unknown/run-tests.sh']) {
    assert.match(plan(path), /^full::/, path);
  }
});

test('payment decision, database, contract, migration and global changes keep the full gate', () => {
  for (const path of [
    'services/api/src/domain/decision.ts',
    'services/yard-api/src/adapters/db-postgres/intakes.ts',
    'services/api/drizzle/0038_new.sql',
    'openapi/stood.json',
    'services/api/src/http/contract.ts',
    'pnpm-lock.yaml',
    'services/yard-api/package.json',
    'services/yard-api/vitest.config.ts',
    'vitest-workspaces.ts',
    'services/yard-api/Dockerfile',
    'tools/site/serve.mjs',
  ]) {
    assert.match(plan(path), /^full::/, path);
  }
});

test('renames retain both paths so a payment source moved into a UI still selects the full gate', () => {
  const repository = mkdtempSync(join(tmpdir(), 'stood-affected-rename-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8', env: isolatedGitEnvironment });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    git('init', '-q');
    git('config', 'user.name', 'Affected selector test');
    git('config', 'user.email', 'affected-selector@example.invalid');
    const source = resolve(repository, 'services/api/src/domain/money.ts');
    const destination = resolve(repository, 'apps/yard-web/src/money.ts');
    mkdirSync(join(repository, 'services/api/src/domain'), { recursive: true });
    mkdirSync(join(repository, 'apps/yard-web/src'), { recursive: true });
    writeFileSync(source, 'export const money = 1;\n');
    git('add', '.');
    git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'test fixture baseline');
    writeFileSync(destination, readFileSync(source));
    rmSync(source);
    git('add', '-A');

    const paths = git('diff', '--no-renames', '--name-only', 'HEAD').split('\n');
    assert.deepEqual(paths.sort(), ['apps/yard-web/src/money.ts', 'services/api/src/domain/money.ts']);
    assert.match(plan(...paths), /^full::/);
    assert.match(readFileSync(runner, 'utf8'), /git diff --no-renames --name-only/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test('missing change information fails safe to the full gate', () => {
  assert.match(plan(), /^full::/);
});
