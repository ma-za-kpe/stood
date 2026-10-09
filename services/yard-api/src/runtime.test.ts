import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createYardApp } from './http/app.js';
import { plannerConfig, yardRuntime } from './runtime.js';

const secret = 's'.repeat(40);
const operators = JSON.stringify([
  { key: 'buyer-key', secret, actor: { id: 'buyer', root: 'buyer-root', kind: 'BUYER' } },
]);
const hosted = {
  YARD_ENV: 'demo',
  YARD_DATABASE_URL: 'postgres://yard_runtime:pw@db.example.neon.tech/neondb?sslmode=verify-full',
  YARD_OPERATORS: operators,
  YARD_SECRET_KEYS: `k1:${randomBytes(32).toString('base64')}`,
};
const capabilities = async (env: Record<string, string>) =>
  (await (await createYardApp(yardRuntime(env).config).request('/health')).json()).capabilities;

// T-0220: one composition root for hosted Yard. Each part runs only when its configuration is complete and safe;
// anything missing is a named note, never a crash, a fallback or a leaked value.
it('wires the Board, site log and secrets from configuration, and says why the rest is off', async () => {
  const runtime = yardRuntime(hosted);
  expect(await capabilities(hosted)).toMatchObject({
    board: true,
    siteLog: true,
    events: true,
    intake: true,
    payments: false,
  });
  expect(runtime.notes).toEqual([
    'Foreman off: GROK_PLANNER_API_KEY is missing.',
    'Payments off: Yard is not connected to Stood yet.',
  ]);
  await runtime.stop();
});

it('stays up with the Board off when configuration is missing or unsafe, without echoing it', async () => {
  for (const [change, note] of [
    [{ YARD_DATABASE_URL: '' }, 'Board off: YARD_DATABASE_URL is missing.'],
    [
      { YARD_DATABASE_URL: 'postgres://yard_runtime:pw@db.example.neon.tech/neondb' },
      'Board off: YARD_DATABASE_URL must use sslmode=verify-full.',
    ],
    [{ YARD_DATABASE_URL: 'not a url pw@' }, 'Board off: YARD_DATABASE_URL is not a URL.'],
    [{ YARD_OPERATORS: '' }, 'Board off: YARD_OPERATORS is missing.'],
    [{ YARD_OPERATORS: '[{"key":"k","secret":"short"}]' }, 'Board off: YARD_OPERATORS is not a valid operator list.'],
    [{ YARD_SECRET_KEYS: 'k1:short' }, 'Board off: YARD_SECRET_KEYS is not a valid key list.'],
  ] as const) {
    const env = { ...hosted, ...change };
    const runtime = yardRuntime(env);
    expect(runtime.notes).toContain(note);
    expect(JSON.stringify(runtime.notes)).not.toMatch(/pw@|short|secret/);
    expect(await capabilities(env)).toMatchObject({ board: false, events: false });
  }
  expect(
    yardRuntime({ YARD_ENV: 'local', YARD_DATABASE_URL: 'postgres://yard_runtime:pw@db:5432/stood' }).notes,
  ).not.toContain('Board off: YARD_DATABASE_URL must use sslmode=verify-full.');
  expect(() => yardRuntime({ ...hosted, YARD_ENV: 'production' })).toThrow(
    'Yard is not configured for hosted operation',
  );
});

// T-0266/T-0267: access codes turn on hosted sign-in; short or repeated codes are refused without echoing them.
it('turns on hosted sign-in and the page only with valid access codes', () => {
  const coded = JSON.stringify([
    { key: 'buyer-key', secret, accessCode: 'a'.repeat(32), actor: { id: 'buyer', root: 'buyer-root', kind: 'BUYER' } },
  ]);
  const on = yardRuntime({ ...hosted, YARD_OPERATORS: coded, YARD_WEB_DIR: '/app/web' });
  expect(on.config.browser).toEqual({ origin: 'https://stood-yard-api.onrender.com' });
  expect(on.config.web).toEqual({ root: '/app/web' });
  const short = yardRuntime({ ...hosted, YARD_OPERATORS: coded.replace('a'.repeat(32), 'short-code') });
  expect(short.notes).toContain('Board off: YARD_OPERATORS is not a valid operator list.');
  expect(JSON.stringify(short.notes)).not.toContain('short-code');
  expect(yardRuntime(hosted).config.browser).toBeUndefined();
});

it('connects private durable intake independently from the planner', async () => {
  const runtime = yardRuntime(hosted);
  expect(runtime.config.board?.intakes).toBeDefined();
  expect(await capabilities(hosted)).toMatchObject({ intake: true, foreman: false, payments: false });
  expect(runtime.notes).not.toContain('Intake and Foreman off: the hosted planner is not connected yet.');
  await runtime.stop();
});

// T-0181: the hosted Foreman runs only with a planner key, a sane daily cap and the GitHub App that pins each
// plan to the sandbox repository's real head. Anything missing is a named note; no value is ever echoed.
it('turns on the Foreman only when the planner, its budget and the GitHub App are all configured', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const planner = {
    ...hosted,
    GROK_PLANNER_API_KEY: 'xai-not-a-real-key-0000',
    GITHUB_APP_ID: '123456',
    GITHUB_APP_PRIVATE_KEY_BASE64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64'),
    GITHUB_APP_INSTALLATION_ID: '987654',
    YARD_SANDBOX_REPOSITORY: 'owner/sandbox',
  };
  // Plans pin the sandbox's real main through a read-only token; any other repository is refused before GitHub.
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${new URL(url).pathname}`);
    return url.endsWith('/access_tokens')
      ? Response.json({ token: 'ghs_read', expires_at: new Date(Date.now() + 600_000).toISOString() })
      : Response.json({ object: { sha: 'a'.repeat(40) } });
  });
  const resolver = plannerConfig(planner, [])?.repositories;
  vi.unstubAllGlobals();
  await expect(resolver?.resolve('buyer', 'owner/other')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(calls).toEqual([]);
  expect(await resolver?.resolve('buyer', 'owner/sandbox')).toEqual({
    repository: 'owner/sandbox',
    baseCommit: 'a'.repeat(40),
  });
  expect(calls).toEqual([
    'POST /app/installations/987654/access_tokens',
    'GET /repos/owner/sandbox/git/ref/heads/main',
  ]);
  expect(plannerConfig({ ...planner, GROK_DAILY_BUDGET_USD: '' }, [])?.dailyMicros).toBe(500_000);
  const on = yardRuntime(planner);
  expect(on.notes).toEqual(['Payments off: Yard is not connected to Stood yet.']);
  expect(await capabilities(planner)).toMatchObject({ board: true, intake: true, foreman: true });
  await on.stop();
  for (const [change, note] of [
    [{ GROK_PLANNER_API_KEY: ' ' }, 'Foreman off: GROK_PLANNER_API_KEY is missing.'],
    [{ GROK_DAILY_BUDGET_USD: 'lots' }, 'Foreman off: GROK_DAILY_BUDGET_USD must be a dollar amount from 0.01 to 5.'],
    [{ GROK_DAILY_BUDGET_USD: '50' }, 'Foreman off: GROK_DAILY_BUDGET_USD must be a dollar amount from 0.01 to 5.'],
    [{ GITHUB_APP_PRIVATE_KEY_BASE64: '' }, 'Foreman off: the GitHub App is not configured.'],
    [{ YARD_SANDBOX_REPOSITORY: 'not a repository' }, 'Foreman off: the GitHub App is not configured.'],
  ] as const) {
    const env = { ...planner, ...change };
    const runtime = yardRuntime(env);
    expect(runtime.notes).toContain(note);
    expect(JSON.stringify(runtime.notes)).not.toMatch(/xai-not|987654|owner\/sandbox|lots/);
    expect(await capabilities(env)).toMatchObject({ foreman: false });
    await runtime.stop();
  }
});
