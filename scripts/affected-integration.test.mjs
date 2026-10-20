import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const selector = resolve(root, 'scripts/affected-packages.mjs');
const selectedPackages = (...paths) => {
  const result = spawnSync(process.execPath, [selector, ...paths], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n').filter(Boolean);
};
const turboPlan = (...packages) => {
  const result = spawnSync(
    'pnpm',
    ['exec', 'turbo', 'run', 'test', 'typecheck', 'build', ...packages.map((name) => `--filter=${name}`), '--dry=json'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
};

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

test('changing simulator source changes the cached API test task hash', () => {
  const sourceFile = resolve(root, 'services/simulators/src/webhooks.ts');
  const original = readFileSync(sourceFile, 'utf8');
  const hash = () =>
    turboPlan('@stood/api', '@stood/provider-simulators').tasks.find((task) => task.taskId === '@stood/api#test')?.hash;
  const before = hash();
  try {
    writeFileSync(sourceFile, `${original}\n// isolated task-hash probe\n`);
    const after = hash();
    assert.ok(before, 'Turbo must report the API test task hash');
    assert.ok(after, 'Turbo must report the API test task hash after the shared source changes');
    assert.notEqual(after, before, 'shared simulator edits must invalidate the API test cache');
  } finally {
    writeFileSync(sourceFile, original);
  }
  assert.equal(readFileSync(sourceFile, 'utf8'), original, 'the hash probe must restore the source byte-for-byte');
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
