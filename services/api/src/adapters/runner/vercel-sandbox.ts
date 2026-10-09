import type { CodeRunner, RunJob, RunResult } from '../../ports/code-runner.js';
// The slice of a Vercel Sandbox session the runner uses; the CLI and worker wire the real SDK to it (ADR-0026).
export type SandboxSession = Readonly<{
  writeFiles(files: readonly Readonly<{ path: string; content: Buffer }>[]): Promise<void>;
  update(change: Readonly<{ networkPolicy: NetworkPolicy }>): Promise<void>;
  runCommand(
    command: Readonly<{ cmd: string; args: readonly string[]; cwd?: string }>,
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

const ROOT = '/vercel/run';
const TEST_SECONDS = 120;
const safe = (path: string) =>
  typeof path === 'string' &&
  path.length > 0 &&
  path.length <= 400 &&
  !path.startsWith('/') &&
  !/[\\\0]/.test(path) &&
  path.split('/').every((part) => part && part !== '.' && part !== '..');

// T-0164 (ADR-0026): runs untrusted code only in a disposable microVM. No credentials enter it; the network reaches
// only the npm registry while dependencies install (scripts off) and nothing at all while the buyer's tests run.
// Each frozen test file passes only on exit 0 within its time limit. A VM that cannot start or dies mid-run is
// RUNNER_UNAVAILABLE: the package waits, it never passes or fails on a missing run.
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
        image: 'vercel/sandbox/node:24',
        resources: { vcpus: 1 },
        timeout: 600_000,
        persistent: false,
        networkPolicy: { allow: ['registry.npmjs.org'] },
      });
    } catch {
      throw new Error('RUNNER_UNAVAILABLE');
    }
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
        const install = await session.runCommand({
          cmd: 'npm',
          args: ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
          cwd: ROOT,
        });
        installExitCode = install.exitCode;
      }
      // From here on the code under test is untrusted: no network at all, not even DNS.
      await session.update({ networkPolicy: 'deny-all' });
      const tests: { id: string; status: 'PASS' | 'FAIL' }[] = [];
      for (const test of job.frozenTests) {
        if (installExitCode !== null && installExitCode !== 0) {
          tests.push({ id: test.id, status: 'FAIL' });
          continue;
        }
        const run = await session.runCommand({
          cmd: 'timeout',
          args: [String(TEST_SECONDS), 'node', '--test', `${ROOT}/${test.path}`],
          cwd: ROOT,
        });
        tests.push({ id: test.id, status: run.exitCode === 0 ? 'PASS' : 'FAIL' });
      }
      return { tests, installExitCode };
    } catch {
      throw new Error('RUNNER_UNAVAILABLE');
    } finally {
      await session.stop().catch(() => undefined);
    }
  }
}
