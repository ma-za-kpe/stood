import type { CodeRunner, RunJob, RunResult } from '../../ports/code-runner.js';
// The slice of a Vercel Sandbox session the runner uses; the CLI and worker wire the real SDK to it (ADR-0026).
export type SandboxSession = Readonly<{
  writeFiles(files: readonly Readonly<{ path: string; content: Buffer }>[]): Promise<void>;
  update(change: Readonly<{ networkPolicy: NetworkPolicy }>): Promise<void>;
  runCommand(
    command: Readonly<{ cmd: string; args: readonly string[]; cwd?: string; sudo?: boolean }>,
  ): Promise<Readonly<{ exitCode: number; stdout(): Promise<string>; stderr(): Promise<string> }>>;
  stop(): Promise<void>;
}>;
// The shape @vercel/sandbox 3.5.0 accepts: a list of allowed domains, or deny-all.
export type NetworkPolicy = 'deny-all' | Readonly<{ allow: readonly string[] }>;
export type SandboxOptions = Readonly<{
  image: string;
  resources: Readonly<{ vcpus: number }>;
  timeout: number;
  persistent: false;
  networkPolicy: NetworkPolicy;
}>;
export type { RunJob, RunResult } from '../../ports/code-runner.js';

// The managed image every run boots. Vercel names it by tag, not digest, so the image itself can change under it.
export const SANDBOX_IMAGE = 'vercel/sandbox/node:24';

const ROOT = '/vercel/run';
// Audit 2026-10-10: npm errors that mean the submission itself is broken. Anything else (registry, DNS, throttling,
// an error npm does not name) is the runner's problem: the package waits instead of being refused.
const SUBMISSION_INSTALL_ERRORS = new Set([
  'E404',
  'ETARGET',
  'EJSONPARSE',
  'ENOVERSIONS',
  'EINVALIDPACKAGENAME',
  'EINVALIDTAGNAME',
  'ERESOLVE',
]);
// Audit 2026-10-10: exit code 0 is not proof. Node's test runner (the parent process, outside the code under test)
// must report real, named test results, all ok, with nothing failed or cancelled. When the test process exits early
// (process.exit before or during the assertions), or declares no tests, Node can only report one result named after
// the file itself: that is a FAIL, never a PASS. Residual risk: code in the test process could still forge the
// runner's messages or disable assertions; ADR-0026 records it.
export function provedPass(tap: string, file: string): boolean {
  const results = [...tap.matchAll(/^(not )?ok \d+ - (.*?)(?: # (SKIP|TODO).*)?$/gm)].map((m) => ({
    ok: !m[1],
    name: (m[2] ?? '').trim(),
    skipped: !!m[3],
  }));
  const count = (name: string) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(tap)?.[1] ?? Number.NaN);
  return (
    results.length > 0 &&
    results.every((r) => r.ok && !r.skipped && r.name !== file && !file.endsWith(`/${r.name}`) && r.name !== '') &&
    count('pass') === results.length &&
    count('fail') === 0 &&
    count('cancelled') === 0 &&
    count('skipped') === 0 &&
    count('todo') === 0
  );
}
// A failure that decides nothing, named by the stage it happened in, so an operator can tell them apart.
export class RunnerUnavailable extends Error {
  constructor(readonly stage: 'CREATE' | 'WRITE' | 'INSTALL' | 'LOCK' | 'NETWORK' | 'TEST') {
    super(`RUNNER_UNAVAILABLE:${stage}`);
  }
}
const TEST_SECONDS = 120;
// Live qualification 2026-10-10: the sandbox's default user (uid 1000) holds every Linux capability, so file
// permissions do not bind it. Tests run as nobody with every capability dropped, no way to regain one (no sudo), and
// an empty environment.
const UNPRIVILEGED = [
  '--reuid=65534',
  '--regid=65534',
  '--clear-groups',
  '--inh-caps=-all',
  '--ambient-caps=-all',
  '--bounding-set=-all',
  '--no-new-privs',
  '--',
  'env',
  '-i',
  'PATH=/usr/local/bin:/usr/bin:/bin',
  'HOME=/tmp',
];
// Succeeds only when that identity can neither create a file in the workspace nor open a frozen test for writing.
// The append runs in a subshell: in dash a failed redirection on a builtin ends the whole shell.
const WRITE_PROBE = `touch ${ROOT}/.stood-probe 2>/dev/null && exit 1; (: >> "$0") 2>/dev/null && exit 1; exit 0`;
const safe = (path: string) =>
  typeof path === 'string' &&
  path.length > 0 &&
  path.length <= 400 &&
  !path.startsWith('/') &&
  !/[\\\0]/.test(path) &&
  path.split('/').every((part) => part && part !== '.' && part !== '..');

// T-0164 (ADR-0026): runs untrusted code only in a disposable microVM. No credentials enter it; the network reaches
// only the npm registry while dependencies install (scripts off) and nothing at all while the buyer's tests run.
// Each frozen test file passes only on exit 0 within its time limit. A VM that cannot start or dies mid-run, or an
// install that fails for any reason but a broken submission, is RunnerUnavailable (with its stage): the package
// waits, it never passes or fails on a missing run.
export class VercelSandboxRunner implements CodeRunner {
  constructor(private readonly sandbox: Readonly<{ create(options: SandboxOptions): Promise<SandboxSession> }>) {}

  async run(job: RunJob): Promise<RunResult> {
    const ids = job.frozenTests.map((t) => t.id);
    const paths = job.frozenTests.map((t) => t.path);
    if (
      !job.frozenTests.length ||
      job.frozenTests.length > 200 ||
      job.source.length > 5000 ||
      new Set(ids).size !== ids.length ||
      new Set(paths).size !== paths.length ||
      ids.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(id)) ||
      ![...job.source.map((f) => f.path), ...paths].every(safe)
    )
      throw new Error('INVALID_JOB');
    let session: SandboxSession;
    try {
      session = await this.sandbox.create({
        image: SANDBOX_IMAGE,
        resources: { vcpus: 1 },
        timeout: 600_000,
        persistent: false,
        networkPolicy: { allow: ['registry.npmjs.org'] },
      });
    } catch {
      throw new RunnerUnavailable('CREATE');
    }
    let stage: RunnerUnavailable['stage'] = 'WRITE';
    try {
      const write = (files: readonly { path: string; content: string }[]) =>
        files.length
          ? session.writeFiles(
              files.map((f) => ({ path: `${ROOT}/${f.path}`, content: Buffer.from(f.content, 'utf8') })),
            )
          : Promise.resolve();
      await write(job.source);
      await write(job.frozenTests);
      let installExitCode: number | null = null;
      if (job.source.some((f) => f.path === 'package.json')) {
        stage = 'INSTALL';
        const install = await session.runCommand({
          cmd: 'npm',
          args: ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
          cwd: ROOT,
        });
        installExitCode = install.exitCode;
        if (installExitCode !== 0) {
          const output = `${await install.stdout()}\n${await install.stderr()}`;
          const code = /npm (?:ERR!|error) code (E[A-Z0-9]+)/.exec(output)?.[1];
          // Only a submission npm itself names as broken fails its tests; every other install failure waits.
          if (!code || !SUBMISSION_INSTALL_ERRORS.has(code)) throw new RunnerUnavailable('INSTALL');
        }
      }
      // Audit 2026-10-10: the code under test must not be able to change what judges it. The whole workspace,
      // frozen tests included, becomes root-owned and read-only before anything runs, and the identity the tests run
      // as must really be refused a write (a permission check alone was fooled by the default user's capabilities).
      stage = 'LOCK';
      const owned = await session.runCommand({ cmd: 'chown', args: ['-R', 'root:root', ROOT], sudo: true });
      const frozen = await session.runCommand({ cmd: 'chmod', args: ['-R', 'a-w', ROOT], sudo: true });
      const probe = await session.runCommand({
        cmd: 'setpriv',
        args: [...UNPRIVILEGED, 'sh', '-c', WRITE_PROBE, `${ROOT}/${job.frozenTests[0]?.path ?? 'package.json'}`],
        sudo: true,
      });
      if (owned.exitCode !== 0 || frozen.exitCode !== 0 || probe.exitCode !== 0) throw new RunnerUnavailable('LOCK');
      // From here on the code under test is untrusted: no network at all, not even DNS.
      stage = 'NETWORK';
      await session.update({ networkPolicy: 'deny-all' });
      stage = 'TEST';
      const tests: { id: string; status: 'PASS' | 'FAIL' }[] = [];
      for (const test of job.frozenTests) {
        if (installExitCode !== null && installExitCode !== 0) {
          tests.push({ id: test.id, status: 'FAIL' });
          continue;
        }
        const file = `${ROOT}/${test.path}`;
        const run = await session.runCommand({
          cmd: 'setpriv',
          args: [...UNPRIVILEGED, 'timeout', String(TEST_SECONDS), 'node', '--test', '--test-reporter=tap', file],
          cwd: ROOT,
          sudo: true,
        });
        const passed = run.exitCode === 0 && provedPass(await run.stdout(), file);
        tests.push({ id: test.id, status: passed ? 'PASS' : 'FAIL' });
      }
      return { tests, installExitCode };
    } catch (error) {
      throw error instanceof RunnerUnavailable ? error : new RunnerUnavailable(stage);
    } finally {
      await session.stop().catch(() => undefined);
    }
  }
}
