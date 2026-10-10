import { VercelSandboxRunner } from './adapters/runner/vercel-sandbox.js';
import { vercelSandbox } from './adapters/runner/vercel-sdk.js';

// Operator tool (T-0164, ADR-0026): qualify the isolated runner on real Vercel Sandbox. A tiny project runs with
// frozen tests that prove each safety claim: correct code passes and wrong code fails, the registry is reachable
// only to install, no network and no credentials while tests run, an unprivileged user, and a runaway process is
// stopped as a failure. Prints only test ids and outcomes.
const test = (body: string) => `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\n${body}\n`;
const expected: Record<string, 'PASS' | 'FAIL'> = {
  pass: 'PASS',
  fail: 'FAIL',
  dependency: 'PASS',
  'no-network': 'PASS',
  'no-secrets': 'PASS',
  'non-root': 'PASS',
  runaway: 'FAIL',
};
const started = Date.now();
const result = await new VercelSandboxRunner(vercelSandbox).run({
  source: [
    {
      path: 'package.json',
      content: JSON.stringify({ name: 'runner-check', type: 'module', dependencies: { 'left-pad': '1.3.0' } }),
    },
    { path: 'src/add.js', content: 'export const add = (a, b) => a + b;\n' },
  ],
  frozenTests: [
    {
      id: 'pass',
      path: 'tests/pass.test.js',
      content: test("import { add } from '../src/add.js';\ntest('adds', () => assert.equal(add(2, 3), 5));"),
    },
    {
      id: 'fail',
      path: 'tests/fail.test.js',
      content: test(
        "import { add } from '../src/add.js';\ntest('wrong on purpose', () => assert.equal(add(2, 2), 5));",
      ),
    },
    {
      id: 'dependency',
      path: 'tests/dependency.test.js',
      content: test(
        "import leftPad from 'left-pad';\ntest('installed from the registry', () => assert.equal(leftPad('7', 3, '0'), '007'));",
      ),
    },
    {
      id: 'no-network',
      path: 'tests/no-network.test.js',
      content: test(
        "test('no egress', async () => { await assert.rejects(fetch('https://example.com', { signal: AbortSignal.timeout(8000) })); });",
      ),
    },
    {
      id: 'no-secrets',
      path: 'tests/no-secrets.test.js',
      content: test(
        "test('no credentials', () => assert.deepEqual(Object.keys(process.env).filter((k) => /TOKEN|SECRET|PASSWORD|API_KEY|VERCEL|STOOD|PAYPAL|GITHUB/i.test(k)), []));",
      ),
    },
    {
      id: 'non-root',
      path: 'tests/non-root.test.js',
      content: test("test('unprivileged', () => assert.notEqual(process.getuid(), 0));"),
    },
    { id: 'runaway', path: 'tests/runaway.test.js', content: test("test('never ends', () => { for (;;) {} });") },
  ],
});
let ok = true;
for (const t of result.tests) {
  const want = expected[t.id];
  const good = t.status === want;
  ok &&= good;
  process.stdout.write(`${good ? 'ok ' : 'BAD'} ${t.id.padEnd(11)} ${t.status} (expected ${want})\n`);
}
process.stdout.write(
  `install exit ${result.installExitCode}; ${Math.round((Date.now() - started) / 1000)}s in total\n`,
);
if (!ok) process.exit(1);
