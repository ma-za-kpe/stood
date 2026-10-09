import { Foreman, GrokPlannerModel, PostgresForemanCoordinator, PostgresSaver } from '@stood/yard-foreman';
import pg from 'pg';
import { LocalKeyWrapper } from './adapters/crypto/local-key-wrapper.js';
import { PostgresYardEvents } from './adapters/db-postgres/events.js';
import { PostgresIntakes } from './adapters/db-postgres/intakes.js';
import { PostgresPlannerSpend } from './adapters/db-postgres/planner-spend.js';
import { PostgresSecretRows } from './adapters/db-postgres/secrets.js';
import { PostgresSiteLogs } from './adapters/db-postgres/site-log.js';
import { GitHubRepositories } from './adapters/github/github.js';
import { GitleaksScanner } from './adapters/log-scanner/gitleaks.js';
import { TribunalCatalog } from './adapters/tribunal-catalog.js';
import { Board, type Operator } from './application/board.js';
import { IntakePlanner } from './application/intake-planner.js';
import { SecretVault } from './application/secret-vault.js';
import { SiteLog } from './application/site-log.js';
import type { createYardApp } from './http/app.js';
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
  notes.push('Payments off: Yard is not connected to Stood yet.');
  if (notes.some((n) => n.startsWith('Board off')) || !operators || !keys)
    return { config: { environment } as Config, notes, start: async () => {}, stop: async () => {} };

  const pool = new pg.Pool({ connectionString: url, max: 5 });
  const clock = async () => Date.now();
  const events = new PostgresYardEvents(pool, clock);
  const board = new Board(events);
  const logs = new PostgresSiteLogs(pool, events);
  const scanner = new GitleaksScanner();
  let retention: ReturnType<typeof startLogRetention> | null = null;
  // T-0266/T-0267: hosted sign-in when the owner issued access codes, and the page when it is built into the image.
  const signIn = operators.some((o) => o.accessCode);
  const intakes = new PostgresIntakes(pool, events);
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
        new PostgresForemanCoordinator(pool),
      )
    : null;
  const config: Config = {
    environment,
    research: new TribunalCatalog(),
    ...(signIn ? { browser: { origin: env.YARD_PUBLIC_ORIGIN ?? 'https://stood-yard-api.onrender.com' } } : {}),
    ...(env.YARD_WEB_DIR ? { web: { root: env.YARD_WEB_DIR } } : {}),
    board: {
      board,
      intakes,
      ...(foreman && planner
        ? { foreman, intakePlanner: new IntakePlanner(intakes, foreman, planner.repositories) }
        : {}),
      clock,
      operators,
      secrets: new SecretVault(new PostgresSecretRows(pool), new LocalKeyWrapper(keys.keys, keys.current)),
      siteLog: new SiteLog(logs, board, scanner),
    },
  };
  return {
    config,
    notes,
    async start() {
      await scanner.ready();
      retention = startLogRetention(logs, clock, (code) => process.stderr.write(`${JSON.stringify({ code })}\n`));
      await retention.run();
    },
    async stop() {
      retention?.stop();
      await pool.end();
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
    apiKey,
    model: env.GROK_PLANNER_MODEL?.trim() || undefined,
    dailyMicros: Math.round(dollars * 1_000_000),
    repositories: {
      async resolve(_buyer: string, requested: string) {
        if (requested !== repository) throw new YardError('FORBIDDEN');
        const read = await app.issue(installation, repository, 'READ');
        return { repository, baseCommit: await app.head(read.value, repository, 'main') };
      },
    },
  };
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
