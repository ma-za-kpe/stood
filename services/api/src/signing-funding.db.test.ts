import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { simulatorServer } from '../test/contracts/paypal-simulator.js';
import { PostgresFunding } from './adapters/db-postgres/funding.js';
import { PostgresMandates } from './adapters/db-postgres/mandates.js';
import { PostgresPlatformApi } from './adapters/db-postgres/platform-api.js';
import * as schema from './adapters/db-postgres/schema.js';
import { TokenCipher } from './adapters/db-postgres/token-cipher.js';
import { PostgresTranches } from './adapters/db-postgres/tranches.js';
import { ServerSdkTransport } from './adapters/payments-paypal/sdk.js';
import { createApp } from './http/app.js';
import { signingWorker } from './signing-worker.js';

const name = `test_signing_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const pool = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
const db = drizzle(pool, { schema });
const now = Date.parse('2026-10-05T00:00:00Z');
const vaultKeys = `v1:${randomBytes(32).toString('base64')}`;
const [key, secret] = ['platform_key', 'platform_secret'];
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
function signed(method: string, path: string, body: string, idempotency = '') {
  const t = String(Math.floor(now / 1000));
  return {
    method,
    ...(body ? { body } : {}),
    headers: {
      Authorization: `Bearer ${key}`,
      'Stood-Signature': `t=${t},v2=${createHmac('sha256', secret)
        .update(JSON.stringify(['stood.request@2', t, method, `/v1${path}`, idempotency, '', 'application/json', body]))
        .digest('hex')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotency,
    },
  };
}

// T-0260 end to end: the platform API records intent, the reconciler's worker step makes every PayPal call against
// the simulator, and the buyer approves saving PayPal once. The later hold needs no buyer.
it('signs a saved-PayPal mandate and funds a tranche through the API, the worker and the simulator', async () => {
  const h = await simulatorServer();
  try {
    const platform = new PostgresPlatformApi(db);
    const draft = await platform.create('platform_a', randomUUID(), 'a'.repeat(64), {
      payee_ref: 'sandbox-payee',
      cap: { minor: 1000, currency: 'USD' },
      milestones: [
        { name: 'Build', amount: { minor: 1000, currency: 'USD' }, profile: 'code.milestone@1', params: {} },
      ],
      window_days: 7,
      max_resubmits: 1,
    });
    const app = createApp({
      appEnv: 'ci',
      paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
      demoMode: false,
      api: {
        store: platform,
        platformId: 'platform_a',
        key,
        secret,
        clock: () => now,
        signing: {
          mode: 'sim',
          mandates: new PostgresMandates(db, new TokenCipher(vaultKeys)),
          funding: new PostgresFunding(db),
        },
      },
    });
    const transport = new ServerSdkTransport({
      appEnv: 'ci',
      mode: 'sim',
      baseUrl: h.baseUrl,
      clientId: 'sim-client',
      clientSecret: 'sim-secret',
      vaultReturnUrl: 'http://api:3000/paypal/return',
      vaultCancelUrl: 'http://api:3000/paypal/cancel',
    });
    const tick = signingWorker({
      db,
      transport,
      tranches: new PostgresTranches(db),
      vaultKeys,
      clock: async () => now,
    });
    const mandatePath = `/allowances/${draft.id}/mandate`;
    expect((await app.request(`/v1${mandatePath}`, signed('POST', mandatePath, '{}', 'mandate-1'))).status).toBe(202);
    const read = async (path: string) => (await app.request(`/v1${path}`, signed('GET', path, ''))).json();
    expect(await tick()).toEqual({ mandates: 1, fundings: 0, failed: 0 });
    const awaiting = await read(`${mandatePath}/mandate-1`);
    expect(awaiting).toMatchObject({
      status: 'AWAITING_APPROVAL',
      approve_url: expect.stringContaining('setup-approve'),
    });
    // The buyer approves saving PayPal, once.
    const setupId = new URL(awaiting.approve_url).pathname.split('/').at(-1);
    await fetch(`${h.baseUrl}/__sim/setup-approve/${setupId}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
      body: '{}',
    });
    for (let i = 0; i < 3 && (await read(`${mandatePath}/mandate-1`)).status !== 'SIGNED'; i++) await tick();
    expect(await read(`${mandatePath}/mandate-1`)).toMatchObject({ status: 'SIGNED', approve_url: null });

    const trancheId = draft.tranches[0]?.id ?? '';
    const version = (await platform.tranche('platform_a', trancheId))?.version;
    const fundingPath = `/tranches/${trancheId}/funding`;
    const body = JSON.stringify({ expected_version: version, nonce: 'K7Q' });
    expect((await app.request(`/v1${fundingPath}`, signed('POST', fundingPath, body, 'funding-1'))).status).toBe(202);
    expect(await tick()).toEqual({ mandates: 0, fundings: 1, failed: 0 });
    const held = await read(`${fundingPath}/funding-1`);
    expect(held).toEqual({ key: 'funding-1', status: 'HELD', approve_url: null, hold_expires_at: expect.any(Number) });
    // The token stays sealed in the mandate and never reaches the funding record.
    const sealed = (await pool.query('SELECT token_id FROM mandate_signatures')).rows[0].token_id as string;
    expect(sealed).toMatch(/^v1\./);
    const funding = (await pool.query("SELECT instruction::text AS i FROM funding_operations WHERE key = 'funding-1'"))
      .rows[0].i;
    expect(JSON.parse(funding)).toMatchObject({ source: 'SAVED_PAYPAL' });
    expect(funding).not.toContain('SIM-TOKEN');
    expect(await tick()).toEqual({ mandates: 0, fundings: 0, failed: 0 });
  } finally {
    await h.close();
  }
});
