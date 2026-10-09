import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

it('deploys the real API release with its entrypoint and no test/fake/simulator implementations', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stood-release-'));
  const release = join(directory, 'api');
  try {
    execFileSync('pnpm', ['--filter', '@stood/api', 'build'], { stdio: 'pipe', timeout: 90000 });
    const store = dirname(execFileSync('pnpm', ['store', 'path'], { encoding: 'utf8', timeout: 30000 }).trim());
    execFileSync(
      'pnpm',
      ['--filter', '@stood/api', 'deploy', '--legacy', '--prod', '--prefer-offline', '--store-dir', store, release],
      {
        stdio: 'pipe',
        timeout: 90000,
      },
    );
    expect(existsSync(join(release, 'dist/server.js'))).toBe(true);
    const entries = readdirSync(release).filter((entry) => entry !== 'node_modules');
    // Legacy deploy (no workspace injection) writes no lockfile; dependencies come from the frozen install.
    expect(entries.sort()).toEqual(['dist', 'drizzle', 'package.json']);
    expect(existsSync(join(release, 'drizzle/0000_payment_operations.sql'))).toBe(true);
    const runtimeFiles = readdirSync(join(release, 'dist'), { recursive: true }).map(String);
    expect(readFileSync(join(release, 'dist/adapters/runner/signed-report.js'), 'utf8')).not.toContain('fakeReport');
    expect(runtimeFiles.some((path) => /(^|\/)(test|tests|fakes|simulators)(\/|$)|\.test\./.test(path))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(release, 'package.json'), 'utf8'));
    expect(manifest.dependencies['@stood/provider-simulators']).toBeUndefined();
    expect(existsSync(join(release, 'node_modules/@stood/provider-simulators'))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 240000);
