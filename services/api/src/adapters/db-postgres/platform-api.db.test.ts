import { createHmac, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../http/app.js';
import { PlatformApiStoreError } from '../../ports/platform-api-store.js';
import { PostgresPlatformApi } from './platform-api.js';
import * as schema from './schema.js';

const name = `test_platform_api_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const connectionString = `postgres://stood:stood_local_only@db:5432/${name}`;
const pool = new pg.Pool({ connectionString });
const db = drizzle(pool, { schema });
const store = new PostgresPlatformApi(db);
const input = {
  payee_ref: 'builder',
  cap: { minor: 1000, currency: 'GBP' },
  milestones: [
    { name: 'foundation', amount: { minor: 1000, currency: 'GBP' }, profile: 'construction.stage@1', params: {} },
  ],
  window_days: 7,
  max_resubmits: 1,
};
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
describe('Atomic platform drafts and durable idempotency', () => {
  it('serializes concurrent creates into one draft and returns its original response after restart', async () => {
    const drafts = await Promise.all([
      store.create('platform_a', 'key', 'a'.repeat(64), input),
      store.create('platform_a', 'key', 'a'.repeat(64), input),
    ]);
    expect(drafts[0]).toEqual(drafts[1]);
    expect((await pool.query('SELECT * FROM api_allowances')).rows).toHaveLength(1);
    expect((await pool.query('SELECT * FROM payment_streams')).rows).toHaveLength(1);
    const restart = new pg.Pool({ connectionString });
    try {
      expect(
        await new PostgresPlatformApi(drizzle(restart, { schema })).create('platform_a', 'key', 'a'.repeat(64), input),
      ).toEqual(drafts[0]);
    } finally {
      await restart.end();
    }
  });
  it('rejects changed fingerprints with no write and scopes keys and reads by platform', async () => {
    await expect(store.create('platform_a', 'key', 'b'.repeat(64), input)).rejects.toBeInstanceOf(
      PlatformApiStoreError,
    );
    const other = await store.create('platform_b', 'key', 'a'.repeat(64), input);
    expect(await store.allowance('platform_a', other.id)).toBeNull();
    expect(await store.tranche('platform_a', other.tranches[0]!.id)).toBeNull();
    expect(await store.allowance('platform_b', other.id)).toEqual(other);
    expect(await store.tranche('platform_b', other.tranches[0]!.id)).toMatchObject({
      trancheId: other.tranches[0]!.id,
      version: 0,
      pending: null,
    });
    expect(await store.allowance('platform_a', 'missing')).toBeNull();
    expect(await store.tranche('platform_a', 'missing')).toBeNull();
  });
  it('rolls back the draft, ownership, streams and response when the final write fails', async () => {
    await pool.query(
      "CREATE FUNCTION reject_api_response() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END; $$; CREATE TRIGGER reject_api_response BEFORE INSERT ON api_requests FOR EACH ROW EXECUTE FUNCTION reject_api_response()",
    );
    const before = (await pool.query('SELECT count(*) FROM api_allowances')).rows[0].count;
    try {
      await expect(store.create('platform_a', 'rollback', 'c'.repeat(64), input)).rejects.toThrow();
    } finally {
      await pool.query('DROP TRIGGER reject_api_response ON api_requests; DROP FUNCTION reject_api_response()');
    }
    expect((await pool.query('SELECT count(*) FROM api_allowances')).rows[0].count).toBe(before);
    expect((await pool.query('SELECT count(*) FROM payment_streams')).rows[0].count).toBe(before);
    expect((await pool.query('SELECT * FROM api_requests WHERE key = $1', ['rollback'])).rows).toHaveLength(0);
    expect((await store.create('platform_a', 'rollback', 'c'.repeat(64), input)).status).toBe('DRAFT');
  });
  it('runs signed HTTP creation, exact response replay, conflict and read against real Postgres', async () => {
    const now = 1790985600000;
    const secret = 'fixture_secret';
    const app = createApp({
      appEnv: 'ci',
      paypalBaseUrl: 'https://api-m.sandbox.paypal.com',
      demoMode: false,
      api: { store, platformId: 'http_platform', key: 'fixture_key', secret, clock: () => now },
    });
    const headers = (body: string) => ({
      Authorization: 'Bearer fixture_key',
      'Stood-Signature': `t=${now / 1000},v1=${createHmac('sha256', secret)
        .update(`${now / 1000}.${body}`)
        .digest('hex')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'http_key',
    });
    const body = JSON.stringify(input);
    const first = await app.request('/v1/allowances', { method: 'POST', headers: headers(body), body });
    const repeated = await app.request('/v1/allowances', { method: 'POST', headers: headers(body), body });
    expect(first.status).toBe(201);
    const text = await first.text();
    expect(await repeated.text()).toBe(text);
    const draft = JSON.parse(text);
    const read = await app.request(`/v1/tranches/${draft.tranches[0].id}`, { headers: headers('') });
    expect(await read.json()).toMatchObject({ state: 'PENDING', pending: null, settlement: null });
    const changed = JSON.stringify({ ...input, payee_ref: 'another' });
    expect(
      (await app.request('/v1/allowances', { method: 'POST', headers: headers(changed), body: changed })).status,
    ).toBe(409);
  });
  it('protects ownership and idempotency records against database rewrites', async () => {
    await expect(pool.query("UPDATE api_tranche_owners SET platform_id = 'other'")).rejects.toThrow();
    await expect(pool.query('UPDATE api_requests SET fingerprint = $1', ['d'.repeat(64)])).rejects.toThrow();
    await expect(pool.query('DELETE FROM api_allowances')).rejects.toThrow();
    await expect(store.create('', 'key', 'a'.repeat(64), input)).rejects.toThrow();
    await expect(store.create('platform_a', 'invalid', 'bad', input)).rejects.toThrow();
  });
});
