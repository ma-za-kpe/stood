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
  healthCheckPath?: string;
  autoDeploy?: boolean;
  envVars: EnvVar[];
};
const blueprint = parse(readFileSync('render.yaml', 'utf8')) as { services: Service[] };
const secretName = /SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL|CLIENT_ID|WEBHOOK_ID|OWNER/;
const ownerChoice = ['PROVIDER_PAYPAL'];
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
  ],
};

it('declares Stood services in Frankfurt on free plans with health checks and release-only deploys (T-0214)', () => {
  expect(blueprint.services.map((s) => s.name).sort()).toEqual(Object.keys(reads).sort());
  for (const s of blueprint.services) {
    expect(s).toMatchObject({ runtime: 'docker', region: 'frankfurt', plan: 'free', dockerfilePath: './Dockerfile' });
    expect(s.autoDeploy).toBe(false);
    if (s.type === 'web') expect(s.healthCheckPath).toBe('/health');
  }
  expect(blueprint.services.find((s) => s.name === 'stood-reconciler')).toMatchObject({
    type: 'worker',
    dockerCommand: 'dist/reconcile-cli.js',
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
    expect(s.envVars.find((e) => e.key === 'PAYPAL_BASE_URL')?.value).toBe('https://api-m.sandbox.paypal.com');
    expect(s.envVars.find((e) => e.key === 'APP_ENV')?.value).toBe('demo');
    // The owner chooses sim or live sandbox explicitly; nothing defaults to live.
    expect(s.envVars.find((e) => e.key === 'PROVIDER_PAYPAL')).toEqual({ key: 'PROVIDER_PAYPAL', sync: false });
  }
});
