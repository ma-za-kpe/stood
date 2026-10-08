import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { createYardApp } from './http/app.js';
import { yardRuntime } from './runtime.js';

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
    intake: false,
    payments: false,
  });
  expect(runtime.notes).toEqual([
    'Intake and Foreman off: the hosted planner is not connected yet.',
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
