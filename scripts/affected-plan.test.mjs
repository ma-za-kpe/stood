import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./affected-plan.mjs', import.meta.url));
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

test('missing change information fails safe to the full gate', () => {
  assert.match(plan(), /^full::/);
});
