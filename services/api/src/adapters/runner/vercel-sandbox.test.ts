import { describe, expect, it } from 'vitest';
import {
  provedPass,
  type RunJob,
  RunnerUnavailable,
  type SandboxSession,
  VercelSandboxRunner,
} from './vercel-sandbox.js';

const job: RunJob = {
  source: [
    { path: 'package.json', content: '{"name":"app","type":"module"}' },
    { path: 'src/book.js', content: 'export const book = () => true;' },
    { path: 'tests/booking.test.js', content: 'builder tried to weaken this test' },
  ],
  frozenTests: [
    { id: 't1', path: 'tests/booking.test.js', content: 'import { book } from "../src/book.js"; /* buyer test */' },
    { id: 't2', path: 'tests/refund.test.js', content: 'buyer test two' },
  ],
};
// What Node's TAP reporter prints for a file whose test really ran: a named subtest and matching counts.
const realPass =
  'TAP version 13\n# Subtest: books\nok 1 - books\n  ---\n  ...\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
// What it prints when the code under test calls process.exit(0) before or during the assertions, or declares none.
const fileOnly = (file: string) =>
  `TAP version 13\n# Subtest: ${file}\nok 1 - ${file}\n  ---\n  ...\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;

function fakeSandbox(
  exits: Record<string, number> = {},
  fail?: 'create' | 'install',
  installOutput = '',
  taps: Record<string, string> = {},
) {
  const log: string[] = [];
  let files: Record<string, string> = {};
  const session: SandboxSession = {
    writeFiles: async (list) => {
      for (const f of list) files[f.path] = f.content.toString('utf8');
      log.push(`write ${list.map((f) => f.path).join(',')}`);
    },
    update: async ({ networkPolicy }) => {
      log.push(`network ${JSON.stringify(networkPolicy)}`);
    },
    runCommand: async ({ cmd, args, sudo }) => {
      const line = [cmd, ...args].join(' ');
      log.push(`run ${sudo ? 'sudo ' : ''}${line}`);
      if (fail === 'install' && args.includes('install')) throw new Error('session died');
      const key = Object.keys(exits).find((k) => line.includes(k));
      // The locked workspace is not writable for the unprivileged user unless a test says otherwise.
      const exitCode = key ? (exits[key] as number) : cmd === 'test' ? 1 : 0;
      const tap =
        Object.entries(taps).find(([k]) => line.includes(k))?.[1] ?? (line.includes('--test') ? realPass : '');
      return { exitCode, stdout: async () => tap, stderr: async () => (cmd === 'npm' ? installOutput : '') };
    },
    stop: async () => {
      log.push('stop');
    },
  };
  const options: unknown[] = [];
  const runner = new VercelSandboxRunner({
    create: async (o) => {
      options.push(o);
      if (fail === 'create') throw new Error('vercel unavailable');
      files = {};
      return session;
    },
  });
  return { runner, log, options, files: () => files };
}

// T-0164 (ADR-0026): untrusted code runs only in a disposable microVM, with the buyer's tests, no credentials, the
// registry only during install and no network at all while tests run.
describe('VercelSandboxRunner', () => {
  it('runs each frozen test file with the network off, after writing the buyer tests over the builder ones', async () => {
    const h = fakeSandbox({ 'tests/refund.test.js': 1 });
    const result = await h.runner.run(job);
    expect(result.tests).toEqual([
      { id: 't1', status: 'PASS' },
      { id: 't2', status: 'FAIL' },
    ]);
    expect(h.files()['/vercel/run/tests/booking.test.js']).toContain('buyer test');
    expect(h.options).toEqual([
      {
        image: 'vercel/sandbox/node:24',
        resources: { vcpus: 1 },
        timeout: 600_000,
        persistent: false,
        networkPolicy: { allow: ['registry.npmjs.org'] },
      },
    ]);
    expect(h.log).toEqual([
      'write /vercel/run/package.json,/vercel/run/src/book.js,/vercel/run/tests/booking.test.js',
      'write /vercel/run/tests/booking.test.js,/vercel/run/tests/refund.test.js',
      'run npm install --ignore-scripts --no-audit --no-fund',
      'run sudo chown -R root:root /vercel/run',
      'run sudo chmod -R a-w /vercel/run',
      'run test -w /vercel/run',
      'network "deny-all"',
      'run timeout 120 node --test --test-reporter=tap /vercel/run/tests/booking.test.js',
      'run timeout 120 node --test --test-reporter=tap /vercel/run/tests/refund.test.js',
      'stop',
    ]);
  });

  // Audit 2026-10-10: exit code 0 alone let code under test pass by calling process.exit(0) before its assertions.
  it('passes a test only on real named results from the test runner, never on a clean exit alone', async () => {
    const file = '/vercel/run/tests/booking.test.js';
    const cases: Record<string, string> = {
      'exit before or during the assertions': fileOnly(file),
      'no output': '',
      'a skipped test': realPass.replace('ok 1 - books', 'ok 1 - books # SKIP').replace('# skipped 0', '# skipped 1'),
      'a failing subtest beside a passing one': `${realPass}not ok 2 - refunds\n`,
      'counts that do not match the results': realPass.replace('# pass 1', '# pass 2'),
    };
    for (const [why, tap] of Object.entries(cases)) {
      const h = fakeSandbox({}, undefined, '', { 'booking.test.js': tap });
      const result = await h.runner.run(job);
      expect(result.tests[0], why).toEqual({ id: 't1', status: 'FAIL' });
      expect(result.tests[1], why).toEqual({ id: 't2', status: 'PASS' });
    }
    expect(provedPass(fileOnly('tests/booking.test.js'), file)).toBe(false);
    expect(provedPass(realPass, file)).toBe(true);
  });

  it('skips install without a package.json, and fails a test that times out', async () => {
    const h = fakeSandbox({ 'tests/booking.test.js': 124 });
    const result = await h.runner.run({ ...job, source: job.source.filter((f) => f.path !== 'package.json') });
    expect(result.tests[0]).toEqual({ id: 't1', status: 'FAIL' });
    expect(h.log.some((l) => l.includes('npm install'))).toBe(false);
    expect(h.log).toContain('network "deny-all"');
  });

  // Audit 2026-10-10: an install failure the runner cannot pin on the submission decides nothing.
  it('fails every test only when npm names the submission as broken, and otherwise waits; the VM is always stopped', async () => {
    const broken = fakeSandbox(
      { 'npm install': 1 },
      undefined,
      'npm error code ETARGET\nnpm error notarget No matching version',
    );
    const result = await broken.runner.run(job);
    expect(result.tests.map((t) => t.status)).toEqual(['FAIL', 'FAIL']);
    expect(result.installExitCode).toBe(1);
    expect(broken.log.at(-1)).toBe('stop');
    for (const output of ['npm error code ECONNRESET', 'npm ERR! code E429', 'npm error network request failed', '']) {
      const outage = fakeSandbox({ 'npm install': 1 }, undefined, output);
      await expect(outage.runner.run(job)).rejects.toMatchObject({ stage: 'INSTALL' });
      expect(outage.log.some((l) => l.includes('node --test'))).toBe(false);
      expect(outage.log.at(-1)).toBe('stop');
    }
  });

  it('runs nothing unless the workspace, frozen tests included, is locked read-only for the code under test', async () => {
    for (const exits of [{ chown: 1 }, { chmod: 1 }, { 'test -w': 0 }]) {
      const h = fakeSandbox(exits);
      const error = await h.runner.run(job).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RunnerUnavailable);
      expect(error).toMatchObject({ stage: 'LOCK', message: 'RUNNER_UNAVAILABLE:LOCK' });
      expect(h.log.some((l) => l.includes('node --test'))).toBe(false);
    }
  });

  it('reports an unavailable runner as an error, never as results, and stops a started VM', async () => {
    await expect(fakeSandbox({}, 'create').runner.run(job)).rejects.toMatchObject({ stage: 'CREATE' });
    const died = fakeSandbox({}, 'install');
    await expect(died.runner.run(job)).rejects.toMatchObject({ stage: 'INSTALL' });
    expect(died.log.at(-1)).toBe('stop');
  });

  it('refuses unsafe paths and frozen tests outside the job', async () => {
    const h = fakeSandbox();
    for (const bad of [
      { ...job, source: [{ path: '../escape.js', content: 'x' }] },
      { ...job, frozenTests: [{ id: 't1', path: '/etc/passwd', content: 'x' }] },
      { ...job, frozenTests: [] },
      { ...job, frozenTests: [job.frozenTests[0], job.frozenTests[0]] as RunJob['frozenTests'] },
    ])
      await expect(h.runner.run(bad)).rejects.toThrow('INVALID_JOB');
    expect(h.options).toEqual([]);
  });
});
