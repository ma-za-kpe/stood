import { describe, expect, it } from 'vitest';
import { type RunJob, type SandboxSession, VercelSandboxRunner } from './vercel-sandbox.js';

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
function fakeSandbox(exits: Record<string, number> = {}, fail?: 'create' | 'install') {
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
    runCommand: async ({ cmd, args }) => {
      const line = [cmd, ...args].join(' ');
      log.push(`run ${line}`);
      if (fail === 'install' && args.includes('install')) throw new Error('session died');
      const key = Object.keys(exits).find((k) => line.includes(k));
      return { exitCode: key ? (exits[key] as number) : 0, stdout: async () => '', stderr: async () => '' };
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
      'network "deny-all"',
      'run timeout 120 node --test /vercel/run/tests/booking.test.js',
      'run timeout 120 node --test /vercel/run/tests/refund.test.js',
      'stop',
    ]);
  });

  it('skips install without a package.json, and fails a test that times out', async () => {
    const h = fakeSandbox({ 'tests/booking.test.js': 124 });
    const result = await h.runner.run({ ...job, source: job.source.filter((f) => f.path !== 'package.json') });
    expect(result.tests[0]).toEqual({ id: 't1', status: 'FAIL' });
    expect(h.log.some((l) => l.includes('npm install'))).toBe(false);
    expect(h.log).toContain('network "deny-all"');
  });

  it('fails every test when dependencies cannot install, and still stops the VM', async () => {
    const h = fakeSandbox({ 'npm install': 1 });
    const result = await h.runner.run(job);
    expect(result.tests.map((t) => t.status)).toEqual(['FAIL', 'FAIL']);
    expect(result.installExitCode).toBe(1);
    expect(h.log.at(-1)).toBe('stop');
  });

  it('reports an unavailable runner as an error, never as results, and stops a started VM', async () => {
    await expect(fakeSandbox({}, 'create').runner.run(job)).rejects.toThrow('RUNNER_UNAVAILABLE');
    const died = fakeSandbox({}, 'install');
    await expect(died.runner.run(job)).rejects.toThrow('RUNNER_UNAVAILABLE');
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
