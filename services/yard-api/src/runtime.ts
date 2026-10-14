import { StoodClient } from '@stood/stood-sdk';
import { Foreman, GrokPlannerModel, PostgresForemanCoordinator, PostgresSaver } from '@stood/yard-foreman';
import pg from 'pg';
import { LocalKeyWrapper } from './adapters/crypto/local-key-wrapper.js';
import { usageSigner } from './adapters/crypto/usage-signer.js';
import { PostgresYardEvents } from './adapters/db-postgres/events.js';
import { PostgresIntakes } from './adapters/db-postgres/intakes.js';
import { PostgresPlannerSpend } from './adapters/db-postgres/planner-spend.js';
import { PostgresPreviewSlots } from './adapters/db-postgres/preview-slots.js';
import { PostgresSecretRows } from './adapters/db-postgres/secrets.js';
import { PostgresSiteLogs } from './adapters/db-postgres/site-log.js';
import { GitHubRepositories } from './adapters/github/github.js';
import { GitleaksScanner } from './adapters/log-scanner/gitleaks.js';
import { PayPalPayouts } from './adapters/paypal/payouts.js';
import { PREVIEW_CAP, RenderPreviewHost } from './adapters/render/render-host.js';
import { StoodPackageGateway } from './adapters/stood/package-gateway.js';
import { StoodTrancheProofs } from './adapters/stood/tranche-proofs.js';
import { TribunalCatalog } from './adapters/tribunal-catalog.js';
import { AllowanceAmendments } from './application/allowance-amendments.js';
import { Board, MAX_ACTIVE_CLAIMS, type Operator } from './application/board.js';
import { expireIntakes } from './application/intake-erasure.js';
import { IntakePlanner } from './application/intake-planner.js';
import { MandateBridge } from './application/mandate-bridge.js';
import { runPayouts } from './application/payouts.js';
import { Previews } from './application/previews.js';
import { SecretVault } from './application/secret-vault.js';
import { SiteLog } from './application/site-log.js';
import { StoodWatch } from './application/stood-watch.js';
import { SubmissionBridge } from './application/submission-bridge.js';
import { UsageForwarder } from './application/usage-forwarder.js';
import type { createYardApp } from './http/app.js';
import { type Repeating, repeat } from './jobs/repeat.js';
import { startLogRetention } from './jobs/site-log-retention.js';
import { YardError } from './ports/events.js';

type Env = Readonly<Record<string, string | undefined>>;
type Config = Parameters<typeof createYardApp>[0];
type Operators = NonNullable<Config['board']>['operators'];

// T-0220: the hosted Yard composition root. Each part runs only when its configuration is complete and safe;
// anything missing becomes a named note (never a crash, a fallback or a printed value).
export function yardRuntime(env: Env) {
  const environment = env.YARD_ENV ?? 'local';
  if (!['local', 'ci', 'demo'].includes(environment))
    throw new RangeError('Yard is not configured for hosted operation');
  const notes: string[] = [];
  const url = env.YARD_DATABASE_URL?.trim() ?? '';
  const operators = parseOperators(env.YARD_OPERATORS);
  const keys = parseKeys(env.YARD_SECRET_KEYS);
  if (!url) notes.push('Board off: YARD_DATABASE_URL is missing.');
  else if (!URL.canParse(url)) notes.push('Board off: YARD_DATABASE_URL is not a URL.');
  else if (environment === 'demo' && new URL(url).searchParams.get('sslmode') !== 'verify-full')
    notes.push('Board off: YARD_DATABASE_URL must use sslmode=verify-full.');
  if (!env.YARD_OPERATORS?.trim()) notes.push('Board off: YARD_OPERATORS is missing.');
  else if (!operators) notes.push('Board off: YARD_OPERATORS is not a valid operator list.');
  if (!env.YARD_SECRET_KEYS?.trim()) notes.push('Board off: YARD_SECRET_KEYS is missing.');
  else if (!keys) notes.push('Board off: YARD_SECRET_KEYS is not a valid key list.');
  const planner = plannerConfig(env, notes);
  const stood = stoodClient(env, notes);
  const previewHost = renderPreviews(env, notes);
  if (notes.some((n) => n.startsWith('Board off')) || !operators || !keys)
    return { config: { environment } as Config, notes, jobs: [], start: async () => {}, stop: async () => {} };

  const pool = new pg.Pool({ connectionString: url, max: 5 });
  // Foreman holds coordinator connections while LangGraph reads/writes checkpoints on `pool`.
  // Keep the pools separate so five concurrent plans cannot exhaust checkpoint capacity.
  const foremanCoordinatorPool = new pg.Pool({ connectionString: url, max: 5 });
  // Acquire intake locks before main-pool work; saves waiting on another operation stay out of the five connections
  // that the lock holder needs for reads, checkpoints and cleanup. The dedicated pool supports five lock holders.
  const intakeLockPool = new pg.Pool({ connectionString: url, max: 5 });
  const clock = async () => Date.now();
  const events = new PostgresYardEvents(pool, clock);
  // ADR-0027: with the real Stood, Yard's PayPal merchant id is the payee of every allowance.
  const merchant = env.YARD_PAYPAL_MERCHANT_ID?.trim() ?? '';
  const payee = /^[A-Z0-9]{13}$/.test(merchant) ? merchant : null;
  if (stood && !payee) notes.push("Payments off: YARD_PAYPAL_MERCHANT_ID (Yard's PayPal merchant id) is required.");
  // ADR-0027: Yard's fee on top of each milestone, in basis points (500 is 5%); 0 to 2000, otherwise no fee.
  const feeText = env.YARD_FEE_BPS?.trim() ?? '';
  const feeBps = /^\d{1,4}$/.test(feeText) && Number(feeText) <= 2000 ? Number(feeText) : 0;
  if (feeText && String(feeBps) !== feeText) notes.push('Fee off: YARD_FEE_BPS must be 0 to 2000 basis points.');
  const board = new Board(
    events,
    payee || feeBps ? { maxActiveClaims: MAX_ACTIVE_CLAIMS, ...(payee ? { payee } : {}), feeBps } : undefined,
  );
  const logs = new PostgresSiteLogs(pool, events);
  const scanner = new GitleaksScanner();
  let retention: ReturnType<typeof startLogRetention> | null = null;
  // T-0266/T-0267: hosted sign-in when the owner issued access codes, and the page when it is built into the image.
  const signIn = operators.some((o) => o.accessCode);
  const intakes = new PostgresIntakes(pool, events, intakeLockPool);
  const foreman = planner
    ? new Foreman(
        new GrokPlannerModel({
          apiKey: planner.apiKey,
          ...(planner.model ? { model: planner.model } : {}),
          guard: new PostgresPlannerSpend(pool, planner.dailyMicros),
          // Token counts and cost only: never the prompt, the draft or the key.
          log: (usage) => process.stderr.write(`${JSON.stringify({ code: 'PLANNER_USAGE', ...usage })}\n`),
        }),
        new PostgresSaver(pool, undefined, { schema: 'yard' }),
        false,
        new PostgresForemanCoordinator(foremanCoordinatorPool),
      )
    : null;
  const vault = new SecretVault(new PostgresSecretRows(pool), new LocalKeyWrapper(keys.keys, keys.current));
  // The cap is reserved in Postgres before Render is called, so concurrent deploys cannot both take the last slot.
  const previews = previewHost
    ? new Previews(board, vault, previewHost, { slots: new PostgresPreviewSlots(pool), max: PREVIEW_CAP })
    : null;
  const config: Config = {
    environment,
    research: new TribunalCatalog(),
    ...(signIn
      ? {
          browser: {
            origin: env.YARD_PUBLIC_ORIGIN ?? 'https://stood-yard-api.onrender.com',
            ...(planner ? { plannerRepository: planner.repository } : {}),
          },
        }
      : {}),
    ...(env.YARD_WEB_DIR ? { web: { root: env.YARD_WEB_DIR } } : {}),
    board: {
      board,
      intakes,
      ...(foreman && planner
        ? { foreman, intakePlanner: new IntakePlanner(intakes, foreman, planner.repositories) }
        : {}),
      // C4 (#77): accepted plans become frozen blueprints once Stood's runner shows every frozen test red.
      ...(foreman && planner && stood ? { planBlueprints: { ...planner.seed, stood, intakes } } : {}),
      clock,
      operators,
      secrets: vault,
      siteLog: new SiteLog(logs, board, scanner),
      // T-0189: allowance drafts through Stood's signed API.
      ...(previews ? { previews } : {}),
      ...(stood && payee
        ? { mandates: { createDraft: (input, key) => stood.createDraft(input, key) }, amendments: stood }
        : {}),
      // T-0189: submitted work goes to Stood, whose own runner runs the buyer's frozen tests on the exact commit.
      ...(stood ? { packages: new StoodPackageGateway(stood) } : {}),
    },
  };
  const watch = stood ? new StoodWatch(board, new StoodTrancheProofs(stood)) : null;
  // C4 (#77): the buyer's usage confirmations go to Stood as receipts signed with Yard's usage key.
  const signer = usageSigner(env.YARD_USAGE_KEY_ID, env.YARD_USAGE_SIGNING_KEY);
  if (stood && !signer) notes.push('Usage off: YARD_USAGE_KEY_ID and YARD_USAGE_SIGNING_KEY (Ed25519) are required.');
  const usage = stood && signer ? new UsageForwarder(board, stood, signer, Date.now) : null;
  // ADR-0027: builders are paid out of Yard's own PayPal account (its own REST app, never Stood's), sandbox only.
  const payoutClient = env.YARD_PAYPAL_CLIENT_ID?.trim() ?? '';
  const payoutSecret = env.YARD_PAYPAL_CLIENT_SECRET?.trim() ?? '';
  const payouts =
    payoutClient && payoutSecret
      ? new PayPalPayouts({
          clientId: payoutClient,
          clientSecret: payoutSecret,
          baseUrl: 'https://api-m.sandbox.paypal.com',
        })
      : null;
  if (!payouts)
    notes.push(
      "Payouts off: YARD_PAYPAL_CLIENT_ID and YARD_PAYPAL_CLIENT_SECRET (Yard's own PayPal sandbox app) are required.",
    );
  const payees = new Map(operators.flatMap((o) => (o.payeeRef ? [[o.actor.id, o.payeeRef] as const] : [])));
  // A failure logs its code only (a driver's message can quote stored values); payouts keep their reason, as before.
  const report = (code: string) => (error: unknown) =>
    process.stderr.write(
      `${JSON.stringify(
        code === 'PAYOUTS_FAILED' ? { code, reason: error instanceof Error ? error.message : 'unknown' } : { code },
      )}\n`,
    );
  // Fifth audit (2026-10-11): every periodic job is listed here, when the runtime is built, so a test can see what the
  // hosted worker runs. Each runs once at start, then again a fixed time after its previous pass ended.
  const schedule: { code: string; everyMs: number; task: () => Promise<void> }[] = [];
  // Expired previews, and incomplete or untracked preview deploys, are deleted from Render every hour.
  if (previews)
    schedule.push({
      code: 'PREVIEW_SWEEP_FAILED',
      everyMs: 3_600_000,
      task: async () => {
        const swept = await previews.sweep(Date.now());
        if (Object.values(swept).some((n) => n > 0))
          process.stdout.write(`${JSON.stringify({ code: 'PREVIEWS_SWEPT', ...swept })}\n`);
      },
    });
  // Keys past the seven-day handover deadline are deleted every hour (the vault already refuses them).
  schedule.push({
    code: 'SECRET_PURGE_FAILED',
    everyMs: 3_600_000,
    task: async () => {
      const purged = await vault.purge(Date.now());
      if (purged > 0) process.stdout.write(`${JSON.stringify({ code: 'SECRETS_PURGED', purged })}\n`);
    },
  });
  // A submission or allowance draft interrupted after Yard reserved it (a crash, a lost reply) is delivered by this
  // worker, which owns recovery; what was delivered and what still waits is counted every pass.
  const packages = config.board?.packages,
    drafts = config.board?.mandates;
  const submissions = packages ? new SubmissionBridge(board, packages) : null;
  const mandates = drafts ? new MandateBridge(board, drafts) : null;
  const amendments = config.board?.amendments ? new AllowanceAmendments(board, config.board.amendments) : null;
  if (submissions || mandates || amendments)
    schedule.push({
      code: 'RECOVERY_FAILED',
      everyMs: 60_000,
      task: async () => {
        const s = submissions ? await submissions.recover(Date.now()) : [];
        const m = mandates ? await mandates.recover() : [];
        const a = amendments ? await amendments.recover() : [];
        const count = (rows: readonly { status: string }[], status: string) =>
          rows.filter((r) => r.status === status).length;
        const counts = {
          submissionsDelivered: count(s, 'DELIVERED'),
          submissionsWaiting: count(s, 'WAIT'),
          mandatesDelivered: count(m, 'DELIVERED'),
          mandatesWaiting: count(m, 'WAIT'),
          amendmentsSigned: count(a, 'SIGNED'),
          amendmentsWaiting: a.length - count(a, 'SIGNED'),
        };
        if (Object.values(counts).some((n) => n > 0))
          process.stdout.write(`${JSON.stringify({ code: 'RECOVERY', ...counts })}\n`);
      },
    });
  // Stood sends platforms no notifications: read every tranche Yard waits on, once a minute.
  if (watch) schedule.push({ code: 'STOOD_WATCH_FAILED', everyMs: 60_000, task: async () => void (await watch.run()) });
  // T-0217: intake drafts nobody touched for 90 days are erased once a day, with the planner's copies.
  schedule.push({
    code: 'INTAKE_EXPIRY_FAILED',
    everyMs: 86_400_000,
    task: async () =>
      void (await expireIntakes(
        Date.now(),
        foreman ? { intakes, projects: events, foreman } : { intakes, projects: events },
      )),
  });
  if (payouts) {
    // Third audit (2026-10-11): every run's counts, and each problem with its job, work order and reason.
    const checked = new Map<string, number>();
    schedule.push({
      code: 'PAYOUTS_FAILED',
      everyMs: 60_000,
      task: async () => {
        const { issues, ...counts } = await runPayouts({
          board,
          provider: payouts,
          payeeOf: (id) => payees.get(id),
          clock: Date.now,
          checked,
        });
        if (Object.values(counts).some((n) => n > 0))
          process.stdout.write(`${JSON.stringify({ code: 'PAYOUTS', ...counts })}\n`);
        for (const i of issues) process.stderr.write(`${JSON.stringify(i)}\n`);
      },
    });
  }
  if (usage)
    schedule.push({ code: 'USAGE_FORWARD_FAILED', everyMs: 60_000, task: async () => void (await usage.run()) });
  const running: Repeating[] = [];
  return {
    config,
    notes,
    jobs: schedule.map(({ code, everyMs }) => ({ code, everyMs })),
    async start() {
      await scanner.ready();
      retention = startLogRetention(logs, clock, (code) => process.stderr.write(`${JSON.stringify({ code })}\n`));
      await retention.run();
      for (const { code, everyMs, task } of schedule) {
        const job = repeat(task, everyMs, report(code));
        running.push(job);
        await job.run();
      }
    },
    // Waits for every running pass to finish before the pool closes.
    async stop() {
      await Promise.all([retention?.stop(), ...running.map((job) => job.stop())]);
      await Promise.all([pool.end(), intakeLockPool.end(), foremanCoordinatorPool.end()]);
    },
  };
}

// T-0181: the hosted Foreman needs a planner key, a sane daily cap and the GitHub App, which pins every plan to the
// sandbox repository's real main. Yard plans against that one repository; anything else is refused.
export function plannerConfig(env: Env, notes: string[]) {
  const apiKey = env.GROK_PLANNER_API_KEY?.trim() ?? '';
  const budget = env.GROK_DAILY_BUDGET_USD?.trim() || '0.50';
  const dollars = /^\d{1,2}(\.\d{1,2})?$/.test(budget) ? Number(budget) : Number.NaN;
  const repository = env.YARD_SANDBOX_REPOSITORY?.trim() ?? '';
  const installation = env.GITHUB_APP_INSTALLATION_ID?.trim() ?? '';
  let github: GitHubRepositories | null = null;
  try {
    if (/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) && /^\d+$/.test(installation))
      github = new GitHubRepositories({
        appId: env.GITHUB_APP_ID?.trim() ?? '',
        privateKey: Buffer.from(env.GITHUB_APP_PRIVATE_KEY_BASE64 ?? '', 'base64').toString('utf8'),
        installations: [{ id: installation, owner: repository.split('/')[0] as string }],
        allowed: [repository],
      });
  } catch {
    github = null;
  }
  if (!apiKey) notes.push('Foreman off: GROK_PLANNER_API_KEY is missing.');
  else if (!(dollars >= 0.01 && dollars <= 5))
    notes.push('Foreman off: GROK_DAILY_BUDGET_USD must be a dollar amount from 0.01 to 5.');
  else if (!github) notes.push('Foreman off: the GitHub App is not configured.');
  if (!apiKey || !(dollars >= 0.01 && dollars <= 5) || !github) return null;
  const app = github;
  return {
    repository,
    apiKey,
    model: env.GROK_PLANNER_MODEL?.trim() || undefined,
    dailyMicros: Math.round(dollars * 1_000_000),
    // C4 (#77): the same App seeds the buyer's frozen tests when a plan becomes a blueprint.
    seed: { repositories: app, installation },
    repositories: {
      async resolve(_buyer: string, requested: string) {
        if (requested !== repository) throw new YardError('FORBIDDEN');
        const read = await app.issue(installation, repository, 'READ');
        return { repository, baseCommit: await app.head(read.value, repository, 'main') };
      },
    },
  };
}

// T-0196: previews live in a Render workspace of their own, so this key cannot touch Stood's services.
function renderPreviews(env: Env, notes: string[]) {
  const apiKey = env.RENDER_PREVIEW_API_KEY?.trim() ?? '';
  if (!apiKey) {
    notes.push('Previews off: RENDER_PREVIEW_API_KEY is missing.');
    return null;
  }
  try {
    return new RenderPreviewHost({ apiKey, ownerId: env.RENDER_PREVIEW_OWNER_ID?.trim() ?? '' });
  } catch {
    notes.push('Previews off: RENDER_PREVIEW_API_KEY and RENDER_PREVIEW_OWNER_ID are not both valid.');
    return null;
  }
}

// T-0189: Yard reaches Stood with the platform's own signed API credentials, over https only.
function stoodClient(env: Env, notes: string[]) {
  const key = env.STOOD_API_KEY?.trim() ?? '';
  const secret = env.STOOD_HMAC_SECRET?.trim() ?? '';
  const baseUrl = env.STOOD_API_URL?.trim() || 'https://stood-api.onrender.com';
  if (!key || !secret) notes.push('Payments off: STOOD_API_KEY or STOOD_HMAC_SECRET is missing.');
  else if (!URL.canParse(baseUrl) || new URL(baseUrl).protocol !== 'https:')
    notes.push('Payments off: STOOD_API_URL must be an https URL.');
  else {
    return new StoodClient({ baseUrl, key, secret, clock: Date.now });
  }
  return null;
}

// [{ key, secret (≥ 32 chars), actor: { id, root, kind: BUYER|BUILDER }, payeeRef? }]
function parseOperators(value: string | undefined): Operators | null {
  try {
    const list: unknown = JSON.parse(value ?? '');
    if (!Array.isArray(list) || !list.length) return null;
    const ok = list.every((o) => {
      const actor = o?.actor as Partial<Operator> | undefined;
      return (
        typeof o?.key === 'string' &&
        /^[A-Za-z0-9_-]{3,64}$/.test(o.key) &&
        typeof o.secret === 'string' &&
        o.secret.length >= 32 &&
        typeof actor?.id === 'string' &&
        typeof actor.root === 'string' &&
        (actor.kind === 'BUYER' || actor.kind === 'BUILDER') &&
        (o.payeeRef === undefined || typeof o.payeeRef === 'string') &&
        (o.accessCode === undefined || (typeof o.accessCode === 'string' && o.accessCode.length >= 24))
      );
    });
    const codes = list.map((o) => o.accessCode).filter((c) => c !== undefined);
    return ok && new Set(codes).size === codes.length ? (list as Operators) : null;
  } catch {
    return null;
  }
}

// "k2:<base64 32 bytes>,k1:<base64>": the first key wraps new secrets, every listed key unwraps.
function parseKeys(value: string | undefined): { keys: Record<string, string>; current: string } | null {
  const entries = (value ?? '').split(',').map((e) => e.trim().split(':'));
  if (!entries.length || entries.some((e) => e.length !== 2 || Buffer.from(e[1] ?? '', 'base64').length !== 32))
    return null;
  const keys = Object.fromEntries(entries) as Record<string, string>;
  if (Object.keys(keys).length !== entries.length) return null;
  return { keys, current: entries[0]?.[0] as string };
}
