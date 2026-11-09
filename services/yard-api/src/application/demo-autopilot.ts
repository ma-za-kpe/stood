import type { BaselineInput, BaselineView, FundingView, MandateView, TrancheView } from '@stood/stood-sdk';
import type { BlueprintInput } from '@stood/yard-domain';
import type { YardSnapshot } from '../ports/events.js';
import type { Repositories } from '../ports/repositories.js';
import type { Operator } from './board.js';
import { DEMO_BUDGET_MINOR, DEMO_TASKS, demoSite, demoTests } from './demo-site.js';

// Judge demo autopilot (owner direction, 2026-11-09). One click builds a prewritten three-page website. Only the
// builder is scripted: a Crew operator writes each page from a template and submits it through the ordinary Board.
// Everything about money is real PayPal SANDBOX: Stood's runner judges each commit against frozen tests, Stood
// captures, and Yard pays the Crew from its own sandbox app straight after each release (demo projects only).
// The buyer's single PayPal approval (the saved-account signature) is made by a Kernel cloud browser.

export type YardCall = (
  as: 'buyer' | 'crew',
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  version?: number,
  key?: string,
) => Promise<Record<string, unknown>>;
export type DemoDeps = Readonly<{
  yard: YardCall;
  createDemo(input: BlueprintInput, actor: Operator, key: string, runId: string): Promise<YardSnapshot>;
  stood: Readonly<{
    requestBaseline(input: BaselineInput, key: string): Promise<BaselineView>;
    getBaseline(id: string): Promise<BaselineView>;
    requestVersionMandate(allowanceId: string, version: number, key: string): Promise<MandateView>;
    getMandate(allowanceId: string, key: string): Promise<MandateView>;
    requestFunding(trancheId: string, expectedVersion: number, nonce: string, key: string): Promise<FundingView>;
    getFunding(trancheId: string, key: string): Promise<FundingView>;
    getTranche(trancheId: string): Promise<TrancheView>;
  }>;
  approver: Readonly<{ approve(url: string): Promise<void> }>;
  repositories: Pick<Repositories, 'issue' | 'head' | 'seedTests' | 'push'>;
  installation: string;
  repository: string;
  buyer: Operator;
  // Wake Yard's own background jobs instead of waiting for their next minute.
  wake: Readonly<{ watch(): Promise<void>; usage(): Promise<void>; payouts(): Promise<void> }>;
  clock(): number;
  sleep(ms: number): Promise<void>;
  log(event: Record<string, unknown>): void;
  pollMs?: number;
  deadlineMs?: number;
}>;
export type DemoTaskView = {
  id: string;
  name: string;
  state: 'WAITING' | 'FUNDING' | 'BUILDING' | 'JUDGING' | 'CAPTURED' | 'PAID_OUT' | 'STOPPED';
  commit: string | null;
};
export type DemoRun = {
  runId: string;
  projectId: string;
  buyerId: string;
  status: 'RUNNING' | 'DONE' | 'STOPPED';
  step: string;
  task: number;
  total: number;
  paid: number;
  startedAt: number;
  updatedAt: number;
  error: string | null;
  repository: string;
  branch: string;
  tasks: DemoTaskView[];
  simulated: false;
};
export class DemoError extends Error {}

const NONCE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const object = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export class DemoAutopilot {
  private current: DemoRun | null = null;
  private runs: { at: number }[] = [];
  constructor(
    private readonly deps: DemoDeps,
    private readonly limits = { perDay: 12 },
  ) {}
  status(buyerId: string): DemoRun | null {
    return this.current && this.current.buyerId === buyerId ? structuredClone(this.current) : null;
  }
  // One run at a time across the service, and a daily cap: each run spends a Kernel browser, three Vercel
  // runner checks and about $3 of sandbox money.
  start(buyer: Operator): DemoRun {
    if (buyer.kind !== 'BUYER' || buyer.id !== this.deps.buyer.id) throw new DemoError('FORBIDDEN');
    if (this.current?.status === 'RUNNING') throw new DemoError('BUSY');
    const now = this.deps.clock();
    this.runs = this.runs.filter((r) => now - r.at < 86_400_000);
    if (this.runs.length >= this.limits.perDay) throw new DemoError('DAILY_LIMIT');
    this.runs.push({ at: now });
    const runId = `${new Date(now).toISOString().slice(0, 10).replaceAll('-', '')}-${now.toString(36)}`;
    this.current = {
      runId,
      projectId: `demo-${runId}`,
      buyerId: buyer.id,
      status: 'RUNNING',
      step: 'Writing the plan and freezing the tests',
      task: 0,
      total: DEMO_TASKS.length,
      paid: 0,
      startedAt: now,
      updatedAt: now,
      error: null,
      repository: this.deps.repository,
      branch: `wo/demo-${runId}`,
      tasks: DEMO_TASKS.map((t) => ({ id: t.id, name: t.name, state: 'WAITING', commit: null })),
      simulated: false,
    };
    const run = this.current;
    void this.run(run).catch((error: unknown) => {
      const failedAt = run.step;
      run.status = 'STOPPED';
      run.error = error instanceof DemoError ? error.message : 'The demo stopped; nothing more will be charged.';
      run.step = 'Stopped';
      run.updatedAt = this.deps.clock();
      for (const t of run.tasks) if (!['CAPTURED', 'PAID_OUT'].includes(t.state)) t.state = 'STOPPED';
      // The cause is for the owner's log only: an error code or a Yard path and status, never a secret.
      const cause =
        error instanceof Error
          ? `${error.name}${'code' in error ? `:${String(error.code)}` : ''} ${error.message}`.slice(0, 300)
          : 'unknown';
      this.deps.log({ code: 'DEMO_STOPPED', runId: run.runId, step: run.step, reason: run.error, failedAt, cause });
    });
    return structuredClone(run);
  }
  private say(run: DemoRun, step: string, task?: number) {
    run.step = step;
    if (task !== undefined) run.task = task + 1;
    run.updatedAt = this.deps.clock();
    this.deps.log({ code: 'DEMO_STEP', runId: run.runId, task: run.task, step });
  }
  private async until<T>(label: string, read: () => Promise<T>, done: (v: T) => boolean, wake?: () => Promise<void>) {
    const end = this.deps.clock() + (this.deps.deadlineMs ?? 15 * 60_000);
    for (;;) {
      if (wake) await wake().catch(() => undefined);
      const value = await read();
      if (done(value)) return value;
      if (this.deps.clock() >= end) throw new DemoError(`Timed out waiting for ${label}`);
      await this.deps.sleep(this.deps.pollMs ?? 5_000);
    }
  }
  private async run(run: DemoRun) {
    const d = this.deps,
      id = run.projectId,
      root = `/blueprints/${id}`,
      buyer = d.buyer;
    const room = async () => d.yard('buyer', 'GET', `${root}/room`);
    const write = async (as: 'buyer' | 'crew', path: string, body: unknown, key: string) =>
      d.yard(as, 'POST', path, body, Number((await room()).version), `${run.runId}:${key}`);
    // 1. Freeze: Yard seeds this run's tests onto main; Stood proves each one fails there (a red baseline).
    const tests = demoTests(run.runId);
    const maintain = await d.repositories.issue(d.installation, d.repository, 'MAINTAIN');
    const head = await d.repositories.head(maintain.value, d.repository, 'main');
    const { commit: baseCommit } = await d.repositories.seedTests(
      maintain.value,
      d.repository,
      head,
      Object.fromEntries(tests.map((t) => [t.path, t.content])),
    );
    const now = d.clock();
    await d.createDemo(
      {
        id,
        buyerOperatorId: buyer.id,
        repository: d.repository,
        baseCommit,
        summary: 'Sunrise Café website, built page by page',
        createdAt: now,
        capMinor: DEMO_BUDGET_MINOR * DEMO_TASKS.length,
        currency: 'USD',
        milestones: tests.map((t, i) => ({
          id: t.task.id,
          name: t.task.name,
          budgetMinor: DEMO_BUDGET_MINOR,
          deadline: now + 2 * 86_400_000,
          profileId: i === tests.length - 1 ? 'code.final@1' : 'code.milestone@1',
          testBundleHash: t.testBundleHash,
          manifestHash: t.manifestHash,
          testIds: t.testIds,
          tests: t.tests,
        })),
      },
      buyer,
      `${run.runId}:create`,
      run.runId,
    );
    this.say(run, 'Stood runs the frozen tests on the empty site (they must fail)');
    const baselines = await Promise.all(
      tests.map(async (t) => {
        const requested = await d.stood.requestBaseline(
          {
            repository: d.repository,
            baseCommit,
            testBundleHash: t.testBundleHash,
            manifestHash: t.manifestHash,
            testIds: t.testIds,
            tests: t.tests,
          },
          `demo-baseline:${run.runId}:${t.task.id}`,
        );
        const view = await this.until(
          'the red baseline',
          () => d.stood.getBaseline(requested.id),
          (v) => v.status !== 'QUEUED',
        );
        if (view.status !== 'DONE' || (view.tests ?? []).some((x) => x.status === 'PASS'))
          throw new DemoError('A frozen test did not fail on the empty site');
        return { t, view };
      }),
    );
    await write(
      'buyer',
      `${root}/approve`,
      {
        version: 1,
        buyerOperatorId: buyer.id,
        approvalReference: `demo:${run.runId}`,
        baselines: baselines.map(({ t, view }) => ({
          milestoneId: t.task.id,
          testBundleHash: t.testBundleHash,
          manifestHash: t.manifestHash,
          failedTestIds: (view.tests ?? []).map((x) => x.id),
          reference: `stood-baseline:${view.id}:${view.evidenceSha256}`,
        })),
      },
      'freeze',
    );
    // 2. Sign once: Stood turns the frozen terms into an allowance; the buyer saves PayPal (Kernel approves).
    this.say(run, 'Buyer signs once with PayPal (sandbox)');
    const mandate = object(await write('buyer', `${root}/mandate`, {}, 'draft'));
    const allowanceId = String(mandate.allowanceId ?? '');
    const tranches = object(mandate.tranches);
    if (!allowanceId) throw new DemoError('Stood did not create the allowance');
    const signKey = `${run.runId}:sign`;
    await d.stood.requestVersionMandate(allowanceId, 1, signKey);
    let signing = await this.until(
      'the signing link',
      () => d.stood.getMandate(allowanceId, signKey),
      (v) => ['AWAITING_APPROVAL', 'SIGNED', 'REVOKED'].includes(v.status),
    );
    if (signing.status === 'AWAITING_APPROVAL' && signing.approveUrl) await d.approver.approve(signing.approveUrl);
    signing = await this.until(
      'the signed mandate',
      () => d.stood.getMandate(allowanceId, signKey),
      (v) => ['SIGNED', 'REVOKED'].includes(v.status),
    );
    if (signing.status !== 'SIGNED') throw new DemoError('PayPal did not save the buyer account');
    // 3. Each task, in order: fund from the saved account, Crew builds and submits, Stood judges and pays.
    let parent = baseCommit;
    for (const [index, t] of tests.entries()) {
      const wo = t.task.id,
        view = run.tasks[index] as DemoTaskView,
        trancheId = String(tranches[wo] ?? '');
      if (!trancheId) throw new DemoError('A task has no Stood tranche');
      view.state = 'FUNDING';
      this.say(run, `Stood holds $${(DEMO_BUDGET_MINOR / 100).toFixed(2)} on PayPal for “${t.task.name}”`, index);
      const tranche = await d.stood.getTranche(trancheId);
      const fundKey = `${run.runId}:fund:${wo}`;
      const nonce = Array.from({ length: 3 }, (_, i) => NONCE[(run.startedAt + index * 7 + i * 13) % 32]).join('');
      await d.stood.requestFunding(trancheId, tranche.version, nonce, fundKey);
      let funding = await this.until(
        'the hold',
        () => d.stood.getFunding(trancheId, fundKey),
        (v) => ['AWAITING_APPROVAL', 'HELD', 'FAILED', 'EXPIRED'].includes(v.status),
      );
      if (funding.status === 'AWAITING_APPROVAL' && funding.approveUrl) {
        await d.approver.approve(funding.approveUrl);
        funding = await this.until(
          'the hold',
          () => d.stood.getFunding(trancheId, fundKey),
          (v) => ['HELD', 'FAILED', 'EXPIRED'].includes(v.status),
        );
      }
      if (funding.status !== 'HELD') throw new DemoError('PayPal did not place the hold');
      await write('buyer', `${root}/work-orders`, { milestone: wo }, `post:${wo}`);
      view.state = 'BUILDING';
      this.say(run, `The Crew builds the ${t.task.name.toLowerCase()}`, index);
      const work = () => d.yard('buyer', 'GET', `${root}/work-orders/${wo}`);
      await write('crew', `${root}/work-orders/${wo}/claim`, {}, `claim:${wo}`);
      await this.until('the hold on the Board', work, (v) => !!v.hold, d.wake.watch);
      await write('crew', `${root}/work-orders/${wo}/build`, {}, `build:${wo}`);
      const token = await d.repositories.issue(d.installation, d.repository, 'BUILD', run.branch);
      const pushed = await d.repositories.push(token.value, d.repository, run.branch, parent, demoSite(index));
      parent = pushed.commit;
      view.commit = pushed.commit;
      await write('crew', `${root}/work-orders/${wo}/submit`, { commit: pushed.commit }, `submit:${wo}`);
      view.state = 'JUDGING';
      this.say(run, `Stood runs the frozen tests on the ${t.task.name.toLowerCase()}`, index);
      const final = index === tests.length - 1;
      const judged = await this.until(
        'Stood’s decision',
        () => d.stood.getTranche(trancheId),
        (v) =>
          ['RELEASED', 'REFUSED', 'EXPIRED', 'CANCELLED'].includes(v.state) ||
          (final && v.state === 'WAITING' && /usage/.test(v.decision?.reason ?? '')),
      );
      if (judged.state === 'WAITING') {
        // The final page releases only once the buyer confirms the site works; the demo confirms for the buyer.
        this.say(run, 'Buyer confirms the finished site works', index);
        await write('buyer', `${root}/work-orders/${wo}/usage`, {}, `usage:${wo}`);
      }
      const released = await this.until(
        'the capture',
        () => d.stood.getTranche(trancheId),
        (v) => ['RELEASED', 'REFUSED', 'EXPIRED', 'CANCELLED'].includes(v.state),
        final ? d.wake.usage : undefined,
      );
      if (released.state !== 'RELEASED') throw new DemoError(`Stood did not release “${t.task.name}”`);
      await this.until('Yard recording the payment', work, (v) => v.state === 'PAID', d.wake.watch);
      view.state = 'CAPTURED';
      run.paid++;
      this.say(run, `Captured on PayPal. Paying the Crew for “${t.task.name}”`, index);
      const payout = await this.until(
        'the Crew payout',
        async () =>
          ((await d.yard('buyer', 'GET', `${root}/ledger`)).lines as { wo: string; state: string }[]).find(
            (l) => l.wo === wo,
          )?.state ?? '',
        (state) => ['SENT', 'PAID_OUT', 'FAILED', 'RETURNED', 'REVIEW', 'UNCLAIMED'].includes(state),
        d.wake.payouts,
      );
      if (!['SENT', 'PAID_OUT'].includes(payout)) throw new DemoError('The Crew payout needs the owner’s review');
      view.state = 'PAID_OUT';
    }
    run.status = 'DONE';
    this.say(run, 'Site built. Every page paid on PayPal sandbox.');
  }
}
