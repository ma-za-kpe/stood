import type { CodeRunner, RunJob, RunResult, TestOutcome } from '../../ports/code-runner.js';
// The slice of a Vercel Sandbox session the runner uses; the CLI and worker wire the real SDK to it (ADR-0026).
export type SandboxSession = Readonly<{
  // The provider's id for this VM, for operators (absent in tests).
  id?: string;
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

// The builder's code, readable only by the builder's identity.
const ROOT = '/vercel/run';
// The buyer's frozen tests and Stood's harness, run by the judge's identity; nobody can write here once locked.
const JUDGE = '/vercel/judge';
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
// Second audit (2026-10-11): exit code 0 is not proof that the assertions ran (a skipped test exits 0 too). The judge's
// own TAP report is trustworthy now that builder output cannot reach it, so each file is classified from it.
export function judgeOutcome(tap: string, exitCode: number, file: string): TestOutcome {
  const lines = tap.split('\n');
  const results: { ok: boolean; name: string; directive: string; code: string; failureType: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(not )?ok \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/.exec(lines[i] ?? '');
    if (!m) continue;
    const indent = (m[1] ?? '').length;
    let code = '';
    let failureType = '';
    // The YAML block under a result is indented two spaces deeper than the result itself.
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j] ?? '';
      if (/^\s*(not )?ok \d+ - /.test(line) || /^\s*# Subtest:/.test(line)) break;
      const yaml = new RegExp(`^ {${indent + 2}}(code|failureType): '([^']*)'$`).exec(line);
      if (yaml?.[1] === 'code') code = yaml[2] ?? '';
      if (yaml?.[1] === 'failureType') failureType = yaml[2] ?? '';
    }
    results.push({ ok: !m[2], name: (m[3] ?? '').trim(), directive: m[4] ?? '', code, failureType });
  }
  const count = (name: string) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(tap)?.[1] ?? Number.NaN);
  const [tests, pass, fail] = [count('tests'), count('pass'), count('fail')];
  const notRun =
    !results.length ||
    !(tests > 0) ||
    count('cancelled') !== 0 ||
    count('skipped') !== 0 ||
    count('todo') !== 0 ||
    results.some(
      (r) =>
        r.directive ||
        !r.name ||
        r.name === file ||
        file.endsWith(`/${r.name}`) ||
        (!r.ok && r.code !== 'ERR_ASSERTION' && r.failureType !== 'subtestsFailed'),
    );
  if (notRun) return 'NOT_RUN';
  if (exitCode === 0 && fail === 0 && pass === tests && results.every((r) => r.ok)) return 'PASSED';
  return fail > 0 && exitCode !== 0 ? 'ASSERTION_FAILED' : 'NOT_RUN';
}
// A failure that decides nothing, named by the stage it happened in, so an operator can tell them apart.
export class RunnerUnavailable extends Error {
  constructor(readonly stage: 'CREATE' | 'WRITE' | 'INSTALL' | 'LOCK' | 'NETWORK' | 'TEST' | 'CANCELLED') {
    super(`RUNNER_UNAVAILABLE:${stage}`);
  }
}
const TEST_SECONDS = 120;
const ENV = ['env', '-i', 'PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/tmp'];
// Owner decision 2026-10-10 (ADR-0026 amendment): same-process tests are not evidence, so the code under test and
// the tests run as two processes under two identities. The sandbox's default user holds every Linux capability, so
// both are set explicitly through setpriv.
// The builder: nobody, every capability dropped, no way to regain one, its own workspace as its directory.
export const BUILDER = [
  '--reuid=65534',
  '--regid=65534',
  '--clear-groups',
  '--inh-caps=-all',
  '--ambient-caps=-all',
  '--bounding-set=-all',
  '--no-new-privs',
  '--',
  ...ENV.slice(0, 2),
  '-C',
  ROOT,
  ...ENV.slice(2),
];
// The judge: its own user, outside the builder's group, so it cannot read (and so cannot import) the builder's code.
// It keeps only the capabilities needed to start the builder's process as the builder.
const JUDGE_IDENTITY = [
  '--reuid=65533',
  '--regid=65533',
  '--clear-groups',
  '--inh-caps=-all,+setuid,+setgid,+setpcap',
  '--ambient-caps=-all,+setuid,+setgid,+setpcap',
  '--bounding-set=-all,+setuid,+setgid,+setpcap',
  '--',
  ...ENV.slice(0, 2),
  '-C',
  JUDGE,
  ...ENV.slice(2),
];
// Stood's harness, the only way a frozen test reaches the builder's code: it runs a command as the builder and returns
// what the process did. Tests import it as "stood-harness".
export const HARNESS = `import { spawnSync } from 'node:child_process';
const BUILDER = ${JSON.stringify(BUILDER)};
// Runs one command as the builder, in the builder's workspace, and returns its exit status and output.
export function runBuilder(command, { input = '', timeoutMs = 20000 } = {}) {
  if (!Array.isArray(command) || !command.length || !command.every((a) => typeof a === 'string'))
    throw new TypeError('runBuilder takes the command as an array of strings');
  const r = spawnSync('setpriv', [...BUILDER, ...command], {
    input, encoding: 'utf8', timeout: timeoutMs, cwd: '/', maxBuffer: 8 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { status: r.status, signal: r.signal, stdout: r.stdout, stderr: r.stderr };
}
`;
// Locked means: the builder can create nothing in either directory and write neither its code nor a test; the judge
// cannot read the builder's code or write its own tests. Each probe exits 0 only when every attempt is refused.
// Writes run in subshells: in dash a failed redirection on a builtin ends the whole shell.
const BUILDER_PROBE = `for d in "$1" "$2"; do touch "$d/.stood-probe" 2>/dev/null && exit 1; done; (: >> "$3") 2>/dev/null && exit 1; (: >> "$4") 2>/dev/null && exit 1; exit 0`;
const HARNESS_PACKAGE = JSON.stringify({ name: 'stood-harness', type: 'module', exports: './index.mjs' });
const JUDGE_PROBE = `ls "$1" >/dev/null 2>&1 && exit 1; touch "$2/.stood-probe" 2>/dev/null && exit 1; exit 0`;
const safe = (path: string) =>
  typeof path === 'string' &&
  path.length > 0 &&
  path.length <= 400 &&
  !path.startsWith('/') &&
  !/[\\\0]/.test(path) &&
  path.split('/').every((part) => part && part !== '.' && part !== '..');

// T-0164 (ADR-0026): runs untrusted code only in a disposable microVM. No credentials enter it; the network reaches
// only the npm registry while dependencies install (scripts off) and nothing at all while the buyer's tests run.
// Each frozen test file runs in the judge's own process, apart from the builder's code, and passes only when that
// process exits 0 within its time limit. A VM that cannot start or dies mid-run, or an
// install that fails for any reason but a broken submission, is RunnerUnavailable (with its stage): the package
// waits, it never passes or fails on a missing run.
// Fifth audit (2026-10-11): a VM that could not be stopped is reported with its id, never hidden.
export type CleanupFailure = Readonly<{ code: 'SANDBOX_STOP_FAILED'; sandboxId: string; reason: string }>;
const reportToLog = (failure: CleanupFailure) => process.stderr.write(`${JSON.stringify(failure)}\n`);

export class VercelSandboxRunner implements CodeRunner {
  constructor(
    private readonly sandbox: Readonly<{ create(options: SandboxOptions): Promise<SandboxSession> }>,
    private readonly onCleanupFailure: (failure: CleanupFailure) => void = reportToLog,
  ) {}

  async run(job: RunJob, signal?: AbortSignal): Promise<RunResult> {
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
    if (signal?.aborted) throw new RunnerUnavailable('CANCELLED');
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
    // Fifth audit (2026-10-11): an abort (the queue's deadline) stops the VM at once, which ends whatever command is
    // running; the run then rejects as CANCELLED instead of waiting for the sandbox's own timeout.
    let stopping: Promise<void> | null = null;
    const stop = () => {
      stopping ??= session.stop().catch((error: unknown) =>
        this.onCleanupFailure({
          code: 'SANDBOX_STOP_FAILED',
          sandboxId: session.id ?? 'unknown',
          reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
        }),
      );
      return stopping;
    };
    const abort = () => void stop();
    signal?.addEventListener('abort', abort, { once: true });
    const live = () => {
      if (signal?.aborted) throw new RunnerUnavailable('CANCELLED');
    };
    try {
      const write = (dir: string, files: readonly { path: string; content: string }[]) =>
        files.length
          ? session.writeFiles(
              files.map((f) => ({ path: `${dir}/${f.path}`, content: Buffer.from(f.content, 'utf8') })),
            )
          : Promise.resolve();
      await write(ROOT, job.source);
      // The frozen tests and the harness go only to the judge's directory, never into the builder's workspace.
      await write(JUDGE, [
        ...job.frozenTests,
        { path: 'node_modules/stood-harness/package.json', content: HARNESS_PACKAGE },
        { path: 'node_modules/stood-harness/index.mjs', content: HARNESS },
      ]);
      let installExitCode: number | null = null;
      if (job.source.some((f) => f.path === 'package.json')) {
        live();
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
      // The builder's workspace becomes root-owned, readable only by the builder's group, writable by nobody; the
      // judge's directory root-owned and read-only. Then both identities must really be refused (permissions alone
      // were fooled once by the default user's capabilities).
      live();
      stage = 'LOCK';
      const steps = [
        { cmd: 'chown', args: ['-R', 'root:65534', ROOT] },
        { cmd: 'chmod', args: ['-R', 'u=rX,g=rX,o=', ROOT] },
        { cmd: 'chown', args: ['-R', 'root:root', JUDGE] },
        { cmd: 'chmod', args: ['-R', 'a=rX', JUDGE] },
        {
          cmd: 'setpriv',
          args: [
            ...BUILDER,
            'sh',
            '-c',
            BUILDER_PROBE,
            'probe',
            ROOT,
            JUDGE,
            `${ROOT}/${job.source[0]?.path ?? 'package.json'}`,
            `${JUDGE}/${job.frozenTests[0]?.path}`,
          ],
        },
        { cmd: 'setpriv', args: [...JUDGE_IDENTITY, 'sh', '-c', JUDGE_PROBE, 'probe', ROOT, JUDGE] },
      ];
      for (const step of steps)
        if ((await session.runCommand({ ...step, sudo: true })).exitCode !== 0) throw new RunnerUnavailable('LOCK');
      // From here on the code under test is untrusted: no network at all, not even DNS.
      live();
      stage = 'NETWORK';
      await session.update({ networkPolicy: 'deny-all' });
      live();
      stage = 'TEST';
      const tests: { id: string; status: 'PASS' | 'FAIL'; outcome: TestOutcome }[] = [];
      for (const test of job.frozenTests) {
        live();
        // The submission's dependencies did not install: no test could run.
        if (installExitCode !== null && installExitCode !== 0) {
          tests.push({ id: test.id, status: 'FAIL', outcome: 'NOT_RUN' });
          continue;
        }
        // The verdict is the judge's own process: a clean Node invocation on the exact frozen file, and its own test
        // report. The builder's code runs only in the processes the harness starts, so it cannot reach either.
        const run = await session.runCommand({
          cmd: 'setpriv',
          args: [
            ...JUDGE_IDENTITY,
            'timeout',
            String(TEST_SECONDS),
            'node',
            '--test',
            '--test-reporter=tap',
            `${JUDGE}/${test.path}`,
          ],
          sudo: true,
        });
        const outcome = judgeOutcome(await run.stdout(), run.exitCode, `${JUDGE}/${test.path}`);
        tests.push({ id: test.id, status: outcome === 'PASSED' ? 'PASS' : 'FAIL', outcome });
      }
      live();
      return { tests, installExitCode };
    } catch (error) {
      if (signal?.aborted) throw new RunnerUnavailable('CANCELLED');
      throw error instanceof RunnerUnavailable ? error : new RunnerUnavailable(stage);
    } finally {
      signal?.removeEventListener('abort', abort);
      await stop();
    }
  }
}
