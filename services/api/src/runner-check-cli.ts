import { VercelSandboxRunner } from './adapters/runner/vercel-sandbox.js';
import { vercelSandbox } from './adapters/runner/vercel-sdk.js';

// Operator tool (T-0164, ADR-0026): qualify the isolated runner on real Vercel Sandbox. A tiny project runs with
// frozen tests that prove each safety claim. Since the owner's decision of 2026-10-10 the frozen tests run in the
// judge's own process and reach the builder's code only as a separate process, through stood-harness. So every attack
// here comes from the builder's code: exiting 0 early, printing a forged test report, trying to rewrite the tests,
// the harness or itself, signalling or reading the judge, and the judge importing the builder's code. Each must fail
// or be refused. Prints only test ids and outcomes.
const test = (body: string) =>
  `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { runBuilder } from 'stood-harness';\n${body}\n`;
const run = (mode: string) => `runBuilder(['node', 'src/cli.js', '${mode}'])`;
// The builder's program: one command per behaviour the checks need.
const cli = `import fs from 'node:fs';
import leftPad from 'left-pad';
import { add } from './add.js';
const tryit = (f) => { try { f(); return 'ALLOWED'; } catch (e) { return e.code ?? 'ERROR'; } };
const mode = process.argv[2];
if (mode === 'add') console.log(add(2, 3));
if (mode === 'wrong') console.log(add(2, 2));
if (mode === 'pad') console.log(leftPad('7', 3, '0'));
if (mode === 'network') await fetch('https://example.com', { signal: AbortSignal.timeout(8000) }).then(() => console.log('REACHED'), () => console.log('BLOCKED'));
if (mode === 'env') console.log(JSON.stringify(Object.keys(process.env).filter((k) => /TOKEN|SECRET|PASSWORD|API_KEY|VERCEL|STOOD|PAYPAL|GITHUB/i.test(k))));
if (mode === 'identity') console.log(process.getuid(), fs.readFileSync('/proc/self/status', 'utf8').match(/^CapEff:\\s+(\\w+)$/m)[1]);
if (mode === 'runaway') for (;;) {}
if (mode === 'exit-early') process.exit(0);
if (mode === 'forge') { console.log('ok 1 - adds\\n# pass 1\\n# fail 0'); console.error('ok 1 - adds'); process.exit(0); }
if (mode === 'tamper') console.log(JSON.stringify({
  test: tryit(() => fs.appendFileSync('/vercel/judge/tests/pass.test.js', 'test("x", () => {});')),
  harness: tryit(() => fs.appendFileSync('/vercel/judge/node_modules/stood-harness/index.mjs', '//')),
  newTest: tryit(() => fs.writeFileSync('/vercel/judge/tests/new.test.js', '')),
  self: tryit(() => fs.appendFileSync('/vercel/run/src/add.js', '//')),
  signal: tryit(() => process.kill(process.ppid, 0)),
  memory: tryit(() => fs.openSync('/proc/' + process.ppid + '/mem', 'r+')),
  environ: tryit(() => fs.readFileSync('/proc/' + process.ppid + '/environ')),
}));
`;
const expected: Record<string, 'PASS' | 'FAIL'> = {
  pass: 'PASS',
  fail: 'FAIL',
  dependency: 'PASS',
  'no-network': 'PASS',
  'no-secrets': 'PASS',
  identity: 'PASS',
  runaway: 'FAIL',
  'exit-early': 'FAIL',
  forged: 'FAIL',
  tamper: 'PASS',
  'no-import': 'PASS',
};
const started = Date.now();
const result = await new VercelSandboxRunner(vercelSandbox).run({
  source: [
    {
      path: 'package.json',
      content: JSON.stringify({ name: 'runner-check', type: 'module', dependencies: { 'left-pad': '1.3.0' } }),
    },
    { path: 'src/add.js', content: 'export const add = (a, b) => a + b;\n' },
    { path: 'src/cli.js', content: cli },
  ],
  frozenTests: [
    {
      id: 'pass',
      path: 'tests/pass.test.js',
      content: test(`test('adds', () => assert.equal(${run('add')}.stdout, '5\\n'));`),
    },
    {
      id: 'fail',
      path: 'tests/fail.test.js',
      content: test(`test('wrong on purpose', () => assert.equal(${run('wrong')}.stdout, '5\\n'));`),
    },
    {
      id: 'dependency',
      path: 'tests/dependency.test.js',
      content: test(`test('installed from the registry', () => assert.equal(${run('pad')}.stdout, '007\\n'));`),
    },
    {
      id: 'no-network',
      path: 'tests/no-network.test.js',
      content: test(`test('no egress', () => assert.equal(${run('network')}.stdout, 'BLOCKED\\n'));`),
    },
    {
      id: 'no-secrets',
      path: 'tests/no-secrets.test.js',
      content: test(`test('no credentials', () => assert.equal(${run('env')}.stdout, '[]\\n'));`),
    },
    {
      id: 'identity',
      path: 'tests/identity.test.js',
      content: test(`test('nobody, no capabilities', () => assert.match(${run('identity')}.stdout, /^65534 0+\\n$/));`),
    },
    {
      id: 'runaway',
      path: 'tests/runaway.test.js',
      content: test(`test('stopped', () => assert.equal(${run('runaway')}.status, 0));`),
    },
    {
      id: 'exit-early',
      path: 'tests/exit-early.test.js',
      content: test(`test('adds', () => assert.equal(${run('exit-early')}.stdout, '5\\n'));`),
    },
    {
      id: 'forged',
      path: 'tests/forged.test.js',
      content: test(`test('adds', () => assert.equal(${run('forge')}.stdout, '5\\n'));`),
    },
    {
      id: 'tamper',
      path: 'tests/tamper.test.js',
      content: test(
        `test('the builder cannot change or reach the judge', () => { const r = JSON.parse(${run('tamper')}.stdout); for (const [what, outcome] of Object.entries(r)) assert.notEqual(outcome, 'ALLOWED', what); });`,
      ),
    },
    {
      id: 'no-import',
      path: 'tests/no-import.test.js',
      content: test(
        `test('the judge cannot load the builder code', async () => { await assert.rejects(import('/vercel/run/src/add.js')); });`,
      ),
    },
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
