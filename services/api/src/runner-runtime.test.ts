import { generateKeyPairSync } from 'node:crypto';
import { expect, it } from 'vitest';
import { runnerSettings } from './runner-runtime.js';

const pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const env = {
  VERCEL_TOKEN: 'vercel-not-real',
  VERCEL_TEAM_ID: 'team_x',
  VERCEL_PROJECT_ID: 'prj_x',
  RUNNER_KEY_ID: 'runner-2026-10',
  RUNNER_SIGNING_KEY: Buffer.from(pem).toString('base64'),
};

// T-0159: the code runner and settlement execution are separate, explicit switches on the reconciler. Missing or
// unsafe settings turn each off with a named note, never a crash and never a printed value.
it('turns the runner on only with Vercel settings and a valid Ed25519 signing key', () => {
  const on = runnerSettings(env);
  expect(on.notes).toEqual(['Settlement off: SETTLEMENT_EXECUTOR is not "on".']);
  expect(on.runner?.key.id).toBe('runner-2026-10');
  expect(on.runner?.verifier).toBeDefined();
  expect(on.settle).toBe(false);
  expect(runnerSettings({ ...env, SETTLEMENT_EXECUTOR: 'on' })).toMatchObject({ settle: true, notes: [] });
  for (const [change, note] of [
    [{ VERCEL_TOKEN: '' }, 'Code runner off: VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID are required.'],
    [{ RUNNER_SIGNING_KEY: '' }, 'Code runner off: RUNNER_KEY_ID and RUNNER_SIGNING_KEY (Ed25519) are required.'],
    [
      { RUNNER_SIGNING_KEY: Buffer.from('not a key').toString('base64') },
      'Code runner off: RUNNER_KEY_ID and RUNNER_SIGNING_KEY (Ed25519) are required.',
    ],
    [{ RUNNER_KEY_ID: 'bad id!' }, 'Code runner off: RUNNER_KEY_ID and RUNNER_SIGNING_KEY (Ed25519) are required.'],
  ] as const) {
    const off = runnerSettings({ ...env, ...change });
    expect(off.runner).toBeNull();
    expect(off.notes).toContain(note);
    expect(JSON.stringify(off.notes)).not.toMatch(/vercel-not-real|PRIVATE KEY/);
  }
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  expect(runnerSettings({ ...env, RUNNER_SIGNING_KEY: Buffer.from(rsa).toString('base64') }).runner).toBeNull();
});
