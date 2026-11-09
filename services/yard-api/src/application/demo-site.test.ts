import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { DEMO_TASKS, demoSite, demoTests } from './demo-site.js';

const run = (files: Record<string, string>, args: readonly string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-site-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    return spawnSync(process.execPath, ['src/cli.js', ...args], { cwd: dir, encoding: 'utf8' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const passes = (files: Record<string, string>, task: (typeof DEMO_TASKS)[number]) =>
  task.cases.every((c) => {
    const r = run(files, c.args);
    return r.status === c.status && r.stdout.includes(c.output);
  });

it('builds each page so exactly its own task and the earlier ones pass, and the empty site fails all', () => {
  for (const task of DEMO_TASKS) expect(passes({}, task)).toBe(false);
  for (const built of DEMO_TASKS.keys()) {
    const files = demoSite(built);
    for (const [i, task] of DEMO_TASKS.entries()) expect(passes(files, task)).toBe(i <= built);
  }
});

it('never writes tests, workflows or a package manifest (Stood refuses those changes)', () => {
  const paths = Object.keys(demoSite(DEMO_TASKS.length - 1));
  expect(paths.every((p) => !p.startsWith('tests/') && !p.startsWith('.github/') && p !== 'package.json')).toBe(true);
  expect(paths).toContain('public/index.html');
});

it('freezes one rendered test file per task with stable, run-scoped paths and hashes', () => {
  const a = demoTests('run1'),
    b = demoTests('run1'),
    c = demoTests('run2');
  expect(a.map((t) => t.path)).toEqual(['home', 'menu', 'contact'].map((id) => `tests/demo-run1-${id}.test.js`));
  expect(a.map((t) => t.testBundleHash)).toEqual(b.map((t) => t.testBundleHash));
  expect(a[0]?.testBundleHash).not.toBe(c[0]?.testBundleHash);
  expect(a[0]?.content).toContain("from 'stood-harness'");
});
