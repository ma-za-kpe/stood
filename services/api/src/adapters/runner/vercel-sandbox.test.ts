import { describe, expect, it } from 'vitest';
import {
  BUILDER,
  HARNESS,
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
const passing =
  'TAP version 13\n# Subtest: books\nok 1 - books\n  ---\n  ...\n1..1\n# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
const failing =
  "TAP version 13\n# Subtest: books\nnot ok 1 - books\n  ---\n  failureType: 'testCodeFailure'\n  code: 'ERR_ASSERTION'\n  ...\n1..1\n# tests 1\n# pass 0\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n";
function fakeSandbox(exits: Record<string, number> = {}, fail?: 'create' | 'install', installOutput = '') {
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
      const exitCode = key ? (exits[key] as number) : 0;
      // What the judge's own node --test prints: a passing test on exit 0, an assertion failure on exit 1.
      const tap = !line.includes('--test') ? '' : exitCode === 0 ? passing : exitCode === 1 ? failing : '';
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
  // Owner decision 2026-10-10: the tests run in the judge's own process; the builder's code only in processes the
  // harness starts as the builder. The frozen tests never enter the builder's workspace.
  it("runs each frozen test in the judge's own process, with the network off, apart from the builder's code", async () => {
    const h = fakeSandbox({ 'node --test --test-reporter=tap /vercel/judge/tests/refund.test.js': 1 });
    const result = await h.runner.run(job);
    expect(result.tests).toEqual([
      { id: 't1', status: 'PASS', outcome: 'PASSED' },
      { id: 't2', status: 'FAIL', outcome: 'ASSERTION_FAILED' },
    ]);
    expect(h.files()['/vercel/judge/tests/booking.test.js']).toContain('buyer test');
    expect(h.files()['/vercel/run/tests/booking.test.js']).toBe('builder tried to weaken this test');
    expect(h.files()['/vercel/judge/node_modules/stood-harness/index.mjs']).toBe(HARNESS);
    expect(h.options).toEqual([
      {
        image: 'vercel/sandbox/node:24',
        resources: { vcpus: 1 },
        timeout: 600_000,
        persistent: false,
        networkPolicy: { allow: ['registry.npmjs.org'] },
      },
    ]);
    const builder = `setpriv ${BUILDER.join(' ')}`;
    const judge =
      'setpriv --reuid=65533 --regid=65533 --clear-groups --inh-caps=-all,+setuid,+setgid,+setpcap --ambient-caps=-all,+setuid,+setgid,+setpcap --bounding-set=-all,+setuid,+setgid,+setpcap -- env -i -C /vercel/judge PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp';
    expect(h.log).toEqual([
      'write /vercel/run/package.json,/vercel/run/src/book.js,/vercel/run/tests/booking.test.js',
      'write /vercel/judge/tests/booking.test.js,/vercel/judge/tests/refund.test.js,/vercel/judge/node_modules/stood-harness/package.json,/vercel/judge/node_modules/stood-harness/index.mjs',
      'run npm install --ignore-scripts --no-audit --no-fund',
      'run sudo chown -R root:65534 /vercel/run',
      'run sudo chmod -R u=rX,g=rX,o= /vercel/run',
      'run sudo chown -R root:root /vercel/judge',
      'run sudo chmod -R a=rX /vercel/judge',
      expect.stringMatching(
        /^run sudo setpriv --reuid=65534 .* sh -c .* probe \/vercel\/run \/vercel\/judge \/vercel\/run\/package.json \/vercel\/judge\/tests\/booking.test.js$/,
      ),
      expect.stringMatching(/^run sudo setpriv --reuid=65533 .* sh -c .* probe \/vercel\/run \/vercel\/judge$/),
      'network "deny-all"',
      `run sudo ${judge} timeout 120 node --test --test-reporter=tap /vercel/judge/tests/booking.test.js`,
      `run sudo ${judge} timeout 120 node --test --test-reporter=tap /vercel/judge/tests/refund.test.js`,
      'stop',
    ]);
    expect(builder).toContain('--bounding-set=-all --no-new-privs -- env -i -C /vercel/run');
  });

  it('skips install without a package.json, and fails a test that times out', async () => {
    const h = fakeSandbox({ 'node --test --test-reporter=tap /vercel/judge/tests/booking.test.js': 124 });
    const result = await h.runner.run({ ...job, source: job.source.filter((f) => f.path !== 'package.json') });
    expect(result.tests[0]).toEqual({ id: 't1', status: 'FAIL', outcome: 'NOT_RUN' });
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

  it('runs nothing unless the builder can write nothing and the judge cannot read the builder code', async () => {
    for (const exits of [
      { 'chown -R root:65534': 1 },
      { 'chmod -R a=rX': 1 },
      { '--reuid=65534': 1 },
      { 'probe /vercel/run /vercel/judge': 3 },
    ]) {
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
