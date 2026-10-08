import pg from 'pg';
import { LocalKeyWrapper } from './adapters/crypto/local-key-wrapper.js';
import { PostgresYardEvents } from './adapters/db-postgres/events.js';
import { PostgresSecretRows } from './adapters/db-postgres/secrets.js';
import { PostgresSiteLogs } from './adapters/db-postgres/site-log.js';
import { GitleaksScanner } from './adapters/log-scanner/gitleaks.js';
import { Board, type Operator } from './application/board.js';
import { SecretVault } from './application/secret-vault.js';
import { SiteLog } from './application/site-log.js';
import type { createYardApp } from './http/app.js';
import { startLogRetention } from './jobs/site-log-retention.js';

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
  notes.push('Intake and Foreman off: the hosted planner is not connected yet.');
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
  const config: Config = {
    environment,
    board: {
      board,
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
        (o.payeeRef === undefined || typeof o.payeeRef === 'string')
      );
    });
    return ok ? (list as Operators) : null;
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
