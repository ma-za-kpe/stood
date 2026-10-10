import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { PAYMENT_KEYS } from '../../src/application/payment-readiness.js';

type EnvVar = { key: string; value?: unknown; sync?: boolean; fromDatabase?: unknown };
type Service = {
  type: string;
  name: string;
  runtime: string;
  region: string;
  plan: string;
  dockerfilePath?: string;
  dockerCommand?: string;
  preDeployCommand?: string;
  healthCheckPath?: string;
  autoDeploy?: boolean;
  autoDeployTrigger?: string;
  branch?: string;
  envVars: EnvVar[];
};
const blueprint = parse(readFileSync('render.yaml', 'utf8')) as { services: Service[] };
const secretName = /SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL|CLIENT_ID|WEBHOOK_ID|OWNER|OPERATORS/;
// The evidence endpoint names the owner's Cloudflare account, so it is prompted rather than committed (C4).
const ownerChoice = ['PROVIDER_PAYPAL', 'SETTLEMENT_EXECUTOR', 'RUNNER_KEY_ID', 'STOOD_EVIDENCE_S3_ENDPOINT'];
const live = /sk_live|rk_live|api-m\.paypal\.com|FLWSECK-(?!TEST)/i;
// Every variable each entry point reads must be declared, so the owner is prompted for all of them.
const reads: Record<string, readonly string[]> = {
  'stood-api': [
    'APP_ENV',
    'DATABASE_URL',
    'DEMO_MODE',
    'PAYPAL_BASE_URL',
    'PORT',
    'PROVIDER_PAYPAL',
    'STOOD_PLATFORM_ID',
    'VAULT_TOKEN_KEYS',
    'USAGE_AUTHORITY_KEYS',
    ...PAYMENT_KEYS,
  ],
  'stood-reconciler': [
    'APP_ENV',
    'DATABASE_URL',
    'PAYPAL_BASE_URL',
    'PROVIDER_PAYPAL',
    'RECONCILIATION_OWNER',
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
    'VAULT_TOKEN_KEYS',
    'VERCEL_TOKEN',
    'VERCEL_TEAM_ID',
    'VERCEL_PROJECT_ID',
    'RUNNER_KEY_ID',
    'RUNNER_SIGNING_KEY',
    'STOOD_EVIDENCE_S3_ENDPOINT',
    'STOOD_EVIDENCE_S3_BUCKET',
    'STOOD_EVIDENCE_S3_ACCESS_KEY_ID',
    'STOOD_EVIDENCE_S3_SECRET_ACCESS_KEY',
    'GITHUB_READ_TOKEN',
    'SETTLEMENT_EXECUTOR',
  ],
  // T-0214: yard-api reads its own restricted database URL; the owner-capable URL is used only by pre-deploy.
  'stood-yard-api': [
    'YARD_ENV',
    'PORT',
    'YARD_DATABASE_URL',
    'YARD_MIGRATION_DATABASE_URL',
    'YARD_OPERATORS',
    'YARD_SECRET_KEYS',
    'GROK_PLANNER_API_KEY',
    'GROK_PLANNER_MODEL',
    'GROK_DAILY_BUDGET_USD',
    'GITHUB_APP_ID',
    'GITHUB_APP_PRIVATE_KEY_BASE64',
    'GITHUB_APP_INSTALLATION_ID',
    'YARD_SANDBOX_REPOSITORY',
    'STOOD_API_URL',
    'STOOD_API_KEY',
    'STOOD_HMAC_SECRET',
    'RENDER_PREVIEW_API_KEY',
    'RENDER_PREVIEW_OWNER_ID',
  ],
};
const stood = (s: Service) => s.name.startsWith('stood-') && s.name !== 'stood-yard-api';

it('declares Stood services in Frankfurt (free web, Starter worker) with health checks and release-only deploys (T-0214)', () => {
  expect(blueprint.services.map((s) => s.name).sort()).toEqual(Object.keys(reads).sort());
  for (const s of blueprint.services) {
    // Render has no free background workers; the owner chose Starter for the reconciler (2026-10-07).
    // The owner chose Starter for the reconciler (2026-10-07) and for Yard (2026-10-08, always on for its jobs).
    expect(s).toMatchObject({
      runtime: 'docker',
      region: 'frankfurt',
      plan: s.type === 'worker' || !stood(s) ? 'starter' : 'free',
      dockerfilePath: stood(s) ? './Dockerfile' : './services/yard-api/Dockerfile',
    });
    // Render deploys from main only after GitHub checks pass: no Actions minutes, no untested release.
    expect(s).toMatchObject({ branch: 'main', autoDeployTrigger: 'checksPass' });
    expect(s.autoDeploy).toBeUndefined();
    if (s.type === 'web') expect(s.healthCheckPath).toBe('/health');
  }
  expect(blueprint.services.find((s) => s.name === 'stood-reconciler')).toMatchObject({
    type: 'worker',
    // Render's dockerCommand replaces the image ENTRYPOINT (distroless /nodejs/bin/node), so name the runtime.
    dockerCommand: '/nodejs/bin/node dist/reconcile-cli.js',
    // T-0253: migrations run before each release goes live; a failure stops the deploy.
    preDeployCommand: '/nodejs/bin/node dist/migrate-cli.js',
  });
  expect(blueprint.services.find((s) => s.name === 'stood-yard-api')).toMatchObject({
    type: 'web',
    preDeployCommand: '/nodejs/bin/node dist/db-cli.js migrate',
  });
});

it('prompts the owner for every secret in their own Render account and commits no values (T-0214)', () => {
  for (const s of blueprint.services) {
    const keys = s.envVars.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const name of reads[s.name] ?? []) expect(keys, `${s.name} ${name}`).toContain(name);
    for (const e of s.envVars) {
      // Secrets and explicit owner choices are prompted; everything else is a committed, non-secret value.
      if (secretName.test(e.key) || ownerChoice.includes(e.key)) {
        expect(e, `${s.name} ${e.key}`).toEqual({ key: e.key, sync: false });
      } else {
        expect(e.sync, `${s.name} ${e.key}`).toBeUndefined();
        expect(typeof e.value, `${s.name} ${e.key}`).toBe('string');
      }
      expect(JSON.stringify(e)).not.toMatch(live);
    }
    if (!stood(s)) {
      // Yard holds no PayPal credentials at all.
      expect(keys.filter((k) => k.includes('PAYPAL'))).toEqual([]);
      expect(s.envVars.find((e) => e.key === 'YARD_ENV')?.value).toBe('demo');
      continue;
    }
    expect(s.envVars.find((e) => e.key === 'PAYPAL_BASE_URL')?.value).toBe('https://api-m.sandbox.paypal.com');
    expect(s.envVars.find((e) => e.key === 'APP_ENV')?.value).toBe('demo');
    // The owner chooses sim or live sandbox explicitly; nothing defaults to live.
    expect(s.envVars.find((e) => e.key === 'PROVIDER_PAYPAL')).toEqual({ key: 'PROVIDER_PAYPAL', sync: false });
  }
});
