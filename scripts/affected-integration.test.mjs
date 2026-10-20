import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const selector = resolve(root, 'scripts/affected-packages.mjs');
const productGate = resolve(root, 'scripts/check-product');
const turbo = resolve(root, 'node_modules/.bin/turbo');
const selectedPackages = (...paths) => {
  const result = spawnSync(process.execPath, [selector, ...paths], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean);
};
const turboPlanAt = (cwd, ...packages) => {
  const result = spawnSync(
    turbo,
    ['run', 'test', 'typecheck', 'build', ...packages.map((name) => `--filter=${name}`), '--dry=json'],
    { cwd, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};
const turboPlan = (...packages) => turboPlanAt(root, ...packages);

test('the full product gate fails when selector integration tests fail', () => {
  const bin = mkdtempSync(join(tmpdir(), 'stood-product-gate-stub-'));
  try {
    const docker = resolve(bin, 'docker');
    writeFileSync(
      docker,
      '#!/bin/sh\ncase "$*" in\n  *affected-integration.test.mjs*) exit 41 ;;\n  *) exit 0 ;;\nesac\n',
    );
    chmodSync(docker, 0o755);
    const result = spawnSync(productGate, [], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}${process.env.PATH ? `:${process.env.PATH}` : ''}`, STOOD_SKIP_PRODUCT_LINT: '1' },
    });
    assert.equal(result.status, 41, result.stderr || result.stdout);
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
});

test('simulator consumers are selected and their test/typecheck tasks depend on the simulator build', () => {
  const packages = selectedPackages('services/simulators/src/webhooks.ts');
  assert.deepEqual(packages, ['@stood/api', '@stood/provider-simulators']);
  const plan = turboPlan(...packages);
  const tasks = new Map(plan.tasks.map((task) => [task.taskId, task]));
  assert.ok(tasks.has('@stood/api#test'), 'simulator source changes must select API tests');
  assert.ok(tasks.has('@stood/provider-simulators#build'), 'API tests import simulator source directly');
  assert.ok(
    tasks.get('@stood/api#test').dependencies.includes('@stood/provider-simulators#build'),
    'API test cache key must include the simulator build task hash',
  );
  assert.ok(
    tasks.get('@stood/api#typecheck').dependencies.includes('@stood/provider-simulators#build'),
    'API typecheck must wait for the simulator declarations it imports',
  );
});

test('changing shared source changes the consumer test hash in an isolated workspace fixture', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'stood-turbo-hash-'));
  try {
    mkdirSync(resolve(fixture, 'packages/provider-simulators/src'), { recursive: true });
    mkdirSync(resolve(fixture, 'packages/api/src'), { recursive: true });
    writeFileSync(
      resolve(fixture, 'package.json'),
      JSON.stringify({ name: 'turbo-hash-fixture', private: true, packageManager: 'pnpm@10.32.1' }),
    );
    writeFileSync(resolve(fixture, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    writeFileSync(resolve(fixture, 'turbo.json'), readFileSync(resolve(root, 'turbo.json'), 'utf8'));
    const tasks = { test: 'node -e "process.exit(0)"', typecheck: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' };
    writeFileSync(
      resolve(fixture, 'packages/provider-simulators/package.json'),
      JSON.stringify({ name: '@stood/provider-simulators', version: '1.0.0', scripts: tasks }),
    );
    writeFileSync(
      resolve(fixture, 'packages/api/package.json'),
      JSON.stringify({
        name: '@stood/api',
        version: '1.0.0',
        scripts: tasks,
        devDependencies: { '@stood/provider-simulators': 'workspace:*' },
      }),
    );
    const sourceFile = resolve(fixture, 'packages/provider-simulators/src/webhooks.ts');
    writeFileSync(sourceFile, 'export const simulated = true;\n');
    const hash = () => turboPlanAt(fixture, '@stood/api').tasks.find((task) => task.taskId === '@stood/api#test')?.hash;
    const before = hash();
    writeFileSync(sourceFile, 'export const simulated = false;\n');
    const after = hash();
    assert.ok(before, 'Turbo must report the API test task hash');
    assert.ok(after, 'Turbo must report the API test task hash after the shared source changes');
    assert.notEqual(after, before, 'shared simulator edits must invalidate the API test cache');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('consumer tasks include shared contract build hashes and build before typecheck', () => {
  const packages = selectedPackages('packages/yard-contracts/src/intake.ts');
  assert.deepEqual(packages, [
    '@stood/yard-api',
    '@stood/yard-contracts',
    '@stood/yard-foreman',
    '@stood/yard-web',
  ]);
  const plan = turboPlan(...packages);
  const tasks = new Map(plan.tasks.map((task) => [task.taskId, task]));
  for (const consumer of ['@stood/yard-api', '@stood/yard-foreman', '@stood/yard-web']) {
    assert.ok(tasks.has(`${consumer}#test`), `${consumer} tests should be in the shared-contract consumer closure`);
    assert.ok(
      tasks.get(`${consumer}#test`).dependencies.some((dependency) => dependency.endsWith('#build')),
      `${consumer} test cache key must include dependency build hashes`,
    );
    assert.ok(
      tasks.get(`${consumer}#typecheck`).dependencies.some((dependency) => dependency.endsWith('#build')),
      `${consumer} typecheck must wait for dependency declaration builds`,
    );
  }
});

test('API unit-test imports have declared workspace edges', () => {
  const workspaces = ['apps', 'packages', 'services'].flatMap((rootName) =>
    readdirSync(resolve(root, rootName), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = resolve(root, rootName, entry.name);
        try {
          const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
          return { directory, manifest };
        } catch {
          return undefined;
        }
      })
      .filter(Boolean),
  );
  const sourceFiles = (directory) =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(file);
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [file] : [];
    });
  const undeclared = [];

  const apiRoot = resolve(root, 'services/api');
  const api = JSON.parse(readFileSync(resolve(apiRoot, 'package.json'), 'utf8'));
  const declared = new Set([
    ...Object.keys(api.dependencies ?? {}),
    ...Object.keys(api.devDependencies ?? {}),
    ...Object.keys(api.optionalDependencies ?? {}),
    ...Object.keys(api.peerDependencies ?? {}),
  ]);
  const apiUnitTests = sourceFiles(apiRoot).filter(
    (file) =>
      (file.includes(`${sep}src${sep}`) || file.includes(`${sep}test${sep}`)) &&
      /\.test\.[cm]?[jt]sx?$/.test(file) &&
      !/\.(?:db|network|sdk)\.test\.[cm]?[jt]sx?$/.test(file) &&
      !file.includes(`${sep}test${sep}network${sep}`) &&
      !file.includes(`${sep}test${sep}sdk${sep}`) &&
      !file.endsWith(`${sep}test${sep}release-artifact.test.ts`),
  );
  for (const file of apiUnitTests) {
    const source = readFileSync(file, 'utf8');
    for (const [, specifier] of source.matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)) {
      if (!specifier.startsWith('.')) continue;
      const target = resolve(dirname(file), specifier);
      const workspace = workspaces.find(
        (candidate) => candidate.directory !== apiRoot &&
          (target === candidate.directory || target.startsWith(`${candidate.directory}${sep}`)),
      );
      if (workspace && !declared.has(workspace.manifest.name)) {
        undeclared.push(`${relative(root, file)} imports ${relative(root, target)} without ${workspace.manifest.name}`);
      }
    }
  }
  assert.deepEqual(undeclared, []);
});
