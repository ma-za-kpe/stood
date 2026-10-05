import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const root = resolve('.');
function violations(from: string, to: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'stood-yard-boundary-'));
  const files: Record<string, string> = {
    'services/api/src/index.js': 'export const value=1;',
    'services/yard-api/src/index.js': 'export const value=1;',
    'services/yard-foreman/src/index.js': 'export const value=1;',
    'apps/yard-web/src/index.js': 'export const value=1;',
    'packages/stood-sdk/src/index.js': 'export const value=1;',
    'packages/contracts/src/index.js': 'export const value=1;',
    'services/yard-crew/src/index.js': 'export const value=1;',
    'services/yard-api/test/fakes/crew/index.js': 'export const value=1;',
    'packages/contracts/crew/index.js': 'export const value=1;',
  };
  files[from] = `import ${JSON.stringify(to)};`;
  try {
    for (const [path, contents] of Object.entries(files)) {
      const full = join(dir, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    const config = require(join(root, '.dependency-cruiser.cjs'));
    writeFileSync(
      join(dir, 'rules.cjs'),
      `module.exports=${JSON.stringify({ ...config, options: { ...config.options, tsConfig: { fileName: join(root, 'tsconfig.json') } } })};`,
    );
    let output: string;
    try {
      output = execFileSync(
        join(root, 'node_modules/.bin/depcruise'),
        ['--config', 'rules.cjs', '--output-type', 'json', 'services', 'apps', 'packages'],
        { cwd: dir, encoding: 'utf8' },
      );
    } catch (error) {
      output = (error as { stdout: string }).stdout;
    }
    return JSON.parse(output).summary.violations.map((v: { rule: { name: string } }) => v.rule.name);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
describe('Real Yard dependency graph boundaries (T-0174)', () => {
  it.each([
    ['services/yard-api/src/index.js', '../../api/src/index.js', 'yard-calls-stood-over-http'],
    ['apps/yard-web/src/index.js', '../../../services/api/src/index.js', 'yard-calls-stood-over-http'],
    ['packages/stood-sdk/src/index.js', '../../../services/api/src/index.js', 'yard-calls-stood-over-http'],
    ['services/yard-foreman/src/index.js', '../../../packages/stood-sdk/src/index.js', 'foreman-plans-only'],
    ['services/yard-foreman/src/index.js', '../../yard-api/src/index.js', 'foreman-plans-only'],
    ['services/yard-foreman/src/index.js', 'node:child_process', 'foreman-plans-only'],
    ['apps/yard-web/src/index.js', '../../../packages/stood-sdk/src/index.js', 'platform-sdk-is-server-only'],
    ['services/yard-api/src/index.js', '../../yard-crew/src/index.js', 'no-internal-crew-imports'],
    ['services/yard-crew/src/index.js', '../../../packages/contracts/src/index.js', 'real-crew-is-external'],
  ])('rejects %s importing %s', (from, to, rule) => {
    expect(violations(from, to)).toContain(rule);
  });
  it('permits HTTP SDK contracts and pure Foreman contract types', () => {
    expect(violations('services/yard-api/src/index.js', '../../../packages/stood-sdk/src/index.js')).toEqual([]);
    expect(violations('services/yard-foreman/src/index.js', '../../../packages/contracts/src/index.js')).toEqual([]);
  });
  it('rejects runtime fake imports while allowing test harnesses and contracts', () => {
    expect(
      violations('packages/contracts/src/index.js', '../../../services/yard-api/test/fakes/crew/index.js'),
    ).toContain('production-cannot-import-simulation');
    expect(violations('services/yard-api/src/index.js', '../test/fakes/crew/index.js')).toContain(
      'production-cannot-import-simulation',
    );
    expect(violations('services/yard-api/test/harness.js', './fakes/crew/index.js')).toEqual([]);
    expect(violations('services/yard-api/src/index.js', '../../../packages/contracts/crew/index.js')).toEqual([]);
  });
});
