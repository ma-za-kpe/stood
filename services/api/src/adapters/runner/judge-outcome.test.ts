import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeOutcome } from './vercel-sandbox.js';

const head = "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\n";
const files: Record<string, [string, string]> = {
  'every test passes': [`${head}test('adds', () => assert.equal(1 + 1, 2));\ntest('again', () => {});`, 'PASSED'],
  'an assertion fails': [
    `${head}test('adds', () => assert.equal(1 + 1, 3));\ntest('ok', () => {});`,
    'ASSERTION_FAILED',
  ],
  'a nested assertion fails': [
    `${head}test('outer', async (t) => { await t.test('inner', () => assert.equal(1, 2)); });`,
    'ASSERTION_FAILED',
  ],
  'a skipped test, nothing else': [`${head}test('s', { skip: true }, () => assert.fail('ran'));`, 'NOT_RUN'],
  'a skipped test beside a passing one': [
    `${head}test('ok', () => {});\ntest('s', { skip: true }, () => {});`,
    'NOT_RUN',
  ],
  'a todo test': [`${head}test('later', { todo: true }, () => {});`, 'NOT_RUN'],
  'no tests at all': [`${head}// nothing`, 'NOT_RUN'],
  'a syntax error': [`${head}test('x', () => { syntax error here`, 'NOT_RUN'],
  'an import that does not exist': [`import { nope } from 'stood-missing';\n${head}test('x', () => {});`, 'NOT_RUN'],
  'an unconditional throw': [`${head}test('boom', () => { throw new TypeError('x is not a function'); });`, 'NOT_RUN'],
  'a throw before any test': [`${head}throw new Error('top');`, 'NOT_RUN'],
  'process.exit(0) midway': [`${head}test('ok', () => {});\ntest('leaves', () => { process.exit(0); });`, 'NOT_RUN'],
};

// Second audit (2026-10-11): a PASS needs every test to have run and passed, and a red baseline needs real assertion
// failures. Classified from Node's real TAP output, not a hand-written copy of it.
describe('judgeOutcome on real node --test output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'judge-'));
  for (const [name, [content, expected]] of Object.entries(files))
    it(`${name}: ${expected}`, () => {
      const file = join(dir, `${name.replaceAll(/\W+/g, '-')}.test.mjs`);
      writeFileSync(file, content);
      const run = spawnSync('node', ['--test', '--test-reporter=tap', file], { encoding: 'utf8', timeout: 30_000 });
      expect(judgeOutcome(run.stdout, run.status ?? 1, file)).toBe(expected);
    });
  it('a timeout (exit 124) or empty output is never a pass', () => {
    expect(judgeOutcome('', 0, '/vercel/judge/tests/a.test.js')).toBe('NOT_RUN');
    expect(judgeOutcome('', 124, '/vercel/judge/tests/a.test.js')).toBe('NOT_RUN');
  });
});
