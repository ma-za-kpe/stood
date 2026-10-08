import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { FaultController } from '../../../../simulators/src/faults.js';
import { simulatorServer } from '../../../test/contracts/paypal-simulator.js';
import { advanceMandate } from '../../application/mandate-signing.js';
import { ServerSdkTransport } from '../payments-paypal/sdk.js';
import { PayPalVaultAdapter } from '../payments-paypal/vault.js';
import { PostgresFunding } from './funding.js';
import { mandateTermsHash, PostgresMandates } from './mandates.js';
import { PostgresPlatformApi } from './platform-api.js';
import * as schema from './schema.js';
import { TokenCipher } from './token-cipher.js';

const name = `test_mandates_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const options = {
  connectionString: `postgres://stood:stood_local_only@db:5432/${name}`,
  options: '-c statement_timeout=5000',
};
const v1 = `v1:${randomBytes(32).toString('base64')}`,
  v2 = `v2:${randomBytes(32).toString('base64')}`;
const cipher = new TokenCipher(v1);
const pool = new pg.Pool(options),
  db = drizzle(pool, { schema }),
  store = new PostgresMandates(db, cipher);
const now = Date.parse('2026-10-05T00:00:00Z');
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
async function setup() {
  const draft = await new PostgresPlatformApi(db).create('buyer', randomUUID(), 'a'.repeat(64), {
    payee_ref: 'sandbox-payee',
    cap: { minor: 1000, currency: 'USD' },
    milestones: [{ name: 'Build', amount: { minor: 1000, currency: 'USD' }, profile: 'code.milestone@1', params: {} }],
    window_days: 7,
    max_resubmits: 1,
  });
  return {
    draft,
    input: {
      key: randomUUID(),
      platformId: 'buyer',
      allowanceId: draft.id,
      termsVersion: 1,
      termsHash: mandateTermsHash(draft),
      acceptedAt: now,
      mode: 'sim' as const,
    },
  };
}
const receipt = (key: string) => ({
  setupId: `SETUP-${key}`,
  customerId: `CUSTOMER-${key}`,
  approvalUrl: `http://paypal-sim:8080/__sim/setup-approve/SETUP-${key}`,
});
async function tokenizing() {
  const value = await setup();
  const reserved = await store.reserve(value.input);
  await store.beginCreate(value.input.key, reserved.version);
  await store.setupCreated(value.input.key, receipt(value.input.key));
  await store.beginTokenize(value.input.key, 2, 'PAYER');
  return value;
}
it('reserves exact signed terms and independent provider IDs durably, with tenant isolation', async () => {
  const { input } = await setup();
  const reserved = await store.reserve(input);
  expect(reserved.status).toBe('RESERVED');
  expect(reserved.setupRequestId).not.toBe(reserved.tokenRequestId);
  expect(reserved.customerRef).toMatch(/^[a-f0-9]{64}$/);
  expect(reserved.expiresAt).toBe(now + 7 * 86400000);
  const other = new pg.Pool(options);
  try {
    expect(await new PostgresMandates(drizzle(other, { schema }), cipher).reserve(input)).toEqual(reserved);
  } finally {
    await other.end();
  }
  await expect(store.reserve({ ...input, platformId: 'other' })).rejects.toThrow('NOT_FOUND');
  await expect(store.reserve({ ...input, termsHash: 'b'.repeat(64) })).rejects.toThrow('IDENTITY_CONFLICT');
  await expect(store.reserve({ ...input, termsVersion: 2 })).rejects.toThrow('IDENTITY_CONFLICT');
});
it('allows one active mandate and only one invoker to claim each provider write', async () => {
  const { input } = await setup();
  const reservations = await Promise.allSettled([store.reserve(input), store.reserve({ ...input, key: randomUUID() })]);
  expect(reservations.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  const key = (
    reservations.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof store.reserve>>
    >
  ).value.key;
  const claims = await Promise.allSettled([store.beginCreate(key, 0), store.beginCreate(key, 0)]);
  expect(claims.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  await store.setupCreated(key, receipt(key));
  const tokens = await Promise.allSettled([store.beginTokenize(key, 2, 'PAYER'), store.beginTokenize(key, 2, 'PAYER')]);
  expect(tokens.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect((await store.events(key)).map((x) => x.status)).toEqual([
    'RESERVED',
    'CREATING',
    'AWAITING_APPROVAL',
    'TOKENIZING',
  ]);
});
it('requires a matching known setup, customer and payer before recording a token and treats exact retries as reads', async () => {
  const { input } = await tokenizing();
  const token = {
    setupId: receipt(input.key).setupId,
    customerId: receipt(input.key).customerId,
    payerId: 'PAYER',
    tokenId: `TOKEN-${input.key}`,
  };
  for (const field of ['setupId', 'customerId', 'payerId'] as const)
    await expect(store.confirm(input.key, { ...token, [field]: 'OTHER' })).rejects.toThrow('IDENTITY_CONFLICT');
  const signed = await store.confirm(input.key, token);
  expect(signed.status).toBe('SIGNED');
  expect(await store.confirm(input.key, token)).toEqual(signed);
  await expect(store.confirm(input.key, { ...token, tokenId: 'OTHER' })).rejects.toThrow('IDENTITY_CONFLICT');
  await expect(store.revoke('other', input.key)).rejects.toThrow('NOT_FOUND');
  const revoked = await store.revoke('buyer', input.key);
  expect(revoked.status).toBe('REVOKED');
  expect(await store.revoke('buyer', input.key)).toEqual(revoked);
  await expect(store.beginCreate(input.key, revoked.version)).rejects.toThrow('CONFLICT');
});
it('rolls back the signature phase when its audit insert fails', async () => {
  const { input } = await setup();
  await store.reserve(input);
  await pool.query(
    `CREATE FUNCTION block_mandate_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$`,
  );
  await pool.query(
    `CREATE TRIGGER block_mandate_event BEFORE INSERT ON mandate_events FOR EACH ROW EXECUTE FUNCTION block_mandate_event()`,
  );
  try {
    await expect(store.beginCreate(input.key, 0)).rejects.toThrow();
    expect((await store.load(input.key)).status).toBe('RESERVED');
  } finally {
    await pool.query('DROP TRIGGER block_mandate_event ON mandate_events');
    await pool.query('DROP FUNCTION block_mandate_event()');
  }
});
it('copies provider receipts before awaiting the transaction so caller mutation cannot change the recorded consent', async () => {
  const { input } = await tokenizing();
  const token = {
    setupId: receipt(input.key).setupId,
    customerId: receipt(input.key).customerId,
    payerId: 'PAYER',
    tokenId: `TOKEN-${input.key}`,
  };
  const original = token.tokenId;
  const pending = store.confirm(input.key, token);
  token.tokenId = 'CHANGED-AFTER-CALL';
  expect((await pending).tokenId).toBe(original);
});
it('grants funding authority only for the exact signed tenant, tranche, amount and unexpired terms', async () => {
  const { input, draft } = await tokenizing();
  const funding = await new PostgresFunding(db).reserve({
    key: randomUUID(),
    platformId: 'buyer',
    trancheId: draft.tranches[0]!.id,
    expectedVersion: 0,
    nonce: 'K7Q',
    mode: 'sim',
  });
  expect(await store.canFund(funding.instruction, now)).toBe(false);
  await store.confirm(input.key, {
    setupId: receipt(input.key).setupId,
    customerId: receipt(input.key).customerId,
    payerId: 'PAYER',
    tokenId: `TOKEN-${input.key}`,
  });
  expect(await store.canFund(funding.instruction, now)).toBe(true);
  expect(await store.canFund(funding.instruction, now - 1)).toBe(false);
  expect(await store.canFund(funding.instruction, now + 7 * 86400000)).toBe(false);
  for (const change of [
    { platformId: 'other' },
    { payeeRef: 'other' },
    { trancheId: 'other' },
    { mode: 'live' as const },
    { amount: { minor: 999, currency: 'USD' } },
    { amount: { minor: 1000, currency: 'EUR' } },
  ])
    expect(await store.canFund({ ...funding.instruction, ...change }, now)).toBe(false);
  await store.revoke('buyer', input.key);
  expect(await store.canFund(funding.instruction, now)).toBe(false);
});
it('database guards reject invented signatures, rewritten identities, backward phases and missing audit events', async () => {
  const { input } = await setup();
  const row = await store.reserve(input);
  await expect(
    pool.query('UPDATE mandate_signatures SET status = $1, version = 1 WHERE key = $2', ['SIGNED', input.key]),
  ).rejects.toThrow();
  await expect(
    pool.query('UPDATE mandate_signatures SET terms_hash = $1 WHERE key = $2', ['b'.repeat(64), input.key]),
  ).rejects.toThrow();
  await expect(
    pool.query('UPDATE mandate_signatures SET status = $1, version = 1 WHERE key = $2', ['CREATING', input.key]),
  ).rejects.toThrow();
  await store.beginCreate(input.key, row.version);
  await expect(
    pool.query('UPDATE mandate_signatures SET status = $1, version = 2 WHERE key = $2', ['RESERVED', input.key]),
  ).rejects.toThrow();
  await expect(pool.query('DELETE FROM mandate_events WHERE key = $1', [input.key])).rejects.toThrow();
});
it('rejects a first insert that invents a signature and prevents timestamp or audit-snapshot rewrites', async () => {
  const { input } = await setup();
  await store.reserve(input);
  await expect(
    pool.query(
      `INSERT INTO mandate_signatures
    (key, allowance_id, platform_id, terms_version, terms_hash, customer_ref, mode, status, version,
      setup_request_id, token_request_id, accepted_at, expires_at, setup_id, customer_id, payer_id, token_id, approval_url)
    SELECT $1, allowance_id, platform_id, terms_version, terms_hash, $2, mode, 'SIGNED', 4,
      gen_random_uuid(), gen_random_uuid(), accepted_at, expires_at, 'SETUP', 'CUSTOMER', 'PAYER', 'TOKEN', 'https://www.sandbox.paypal.com/approve'
    FROM mandate_signatures WHERE key = $3`,
      [randomUUID(), 'c'.repeat(64), input.key],
    ),
  ).rejects.toThrow('reserve mandate');
  await expect(
    pool.query(`UPDATE mandate_signatures SET created_at = clock_timestamp() + interval '1 day' WHERE key = $1`, [
      input.key,
    ]),
  ).rejects.toThrow('immutable mandate identity');
  await expect(
    pool.query(`UPDATE mandate_events SET snapshot = jsonb_set(snapshot, '{tokenId}', '"invented"') WHERE key = $1`, [
      input.key,
    ]),
  ).rejects.toThrow('append-only');
});
it('rejects truncation of mandate history even with cascade', async () => {
  const { input } = await setup();
  await store.reserve(input);
  await expect(pool.query('TRUNCATE mandate_signatures, mandate_events CASCADE')).rejects.toThrow('immutable');
  expect((await store.load(input.key)).status).toBe('RESERVED');
});
it('restores a lost actual-SDK token reply across database connections using matching provider status', async () => {
  const h = await simulatorServer(
    new FaultController([{ method: 'POST', path: '/v3/vault/payment-tokens', kind: 'LOST_RESPONSE' }]),
  );
  const other = new pg.Pool(options);
  try {
    const { input } = await setup();
    await store.reserve(input);
    const transport = new ServerSdkTransport({
      appEnv: 'ci',
      mode: 'sim',
      baseUrl: h.baseUrl,
      clientId: 'sim-client',
      clientSecret: 'sim-secret',
      vaultReturnUrl: 'http://api:3000/paypal/return',
      vaultCancelUrl: 'http://api:3000/paypal/cancel',
    });
    const provider = new PayPalVaultAdapter(transport),
      api = new PostgresPlatformApi(db);
    const terms = { load: (platform: string, id: string) => api.allowance(platform, id) };
    expect(await advanceMandate(store, terms, provider, input.key, () => now)).toMatchObject({
      outcome: 'AWAITING_APPROVAL',
    });
    const awaiting = await store.load(input.key);
    expect(
      (
        await fetch(`${h.baseUrl}/__sim/setup-approve/${awaiting.setupId}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer sim-access-token', 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).ok,
    ).toBe(true);
    expect(await advanceMandate(store, terms, provider, input.key, () => now)).toMatchObject({ outcome: 'WAIT' });
    expect((await store.load(input.key)).status).toBe('TOKENIZING');
    const restarted = new PostgresMandates(drizzle(other, { schema }), cipher);
    expect(
      await advanceMandate(restarted, terms, provider, input.key, () => now, { tokenId: 'SIM-TOKEN-3' }),
    ).toMatchObject({ outcome: 'SIGNED' });
    expect((await restarted.load(input.key)).tokenRequestId).toBe(awaiting.tokenRequestId);
    expect((await restarted.events(input.key)).map((event) => event.status)).toEqual([
      'RESERVED',
      'CREATING',
      'AWAITING_APPROVAL',
      'TOKENIZING',
      'SIGNED',
    ]);
    const signed = await restarted.load(input.key);
    expect(await provider.readSetup({ ...signed, status: 'TOKENIZING' })).toEqual({ complete: false });
  } finally {
    await other.end();
    await h.close();
  }
});

// T-0154: funding under a signed saved-PayPal mandate needs no buyer approval. The instruction records only that
// the account is saved; the token stays in the mandate and is handed to the PayPal adapter at call time.
it('funds under a signed mandate straight from CREATING, and keeps the token out of the funding record', async () => {
  const signed = async () => {
    const value = await tokenizing();
    const r = receipt(value.input.key);
    await store.confirm(value.input.key, {
      setupId: r.setupId,
      customerId: r.customerId,
      payerId: 'PAYER',
      tokenId: `TOKEN-${value.input.key}`,
    });
    return value;
  };
  const funding = new PostgresFunding(db);
  const reserve = (draft: Awaited<ReturnType<typeof setup>>['draft']) =>
    funding.reserve({
      key: randomUUID(),
      trancheId: draft.tranches[0]!.id,
      platformId: 'buyer',
      expectedVersion: 0,
      nonce: 'K7Q',
      mode: 'sim',
    });
  const hold = (orderId: string) => ({
    orderId,
    authorizationId: `AUTH-${orderId}`,
    heldAt: now,
    expiresAt: now + 29 * 86400000,
    reference: `${orderId}:AUTH-${orderId}`,
  });
  const held = await signed();
  const reserved = await reserve(held.draft);
  expect(reserved.instruction.source).toBe('SAVED_PAYPAL');
  expect(JSON.stringify(reserved)).not.toContain('TOKEN-');
  expect(await store.tokenFor(reserved.instruction)).toBe(`TOKEN-${held.input.key}`);
  expect(await store.tokenFor({ ...reserved.instruction, mode: 'live' })).toBeNull();
  expect(await store.tokenFor({ ...reserved.instruction, platformId: 'other' })).toBeNull();
  const creating = await funding.beginCreate(reserved.key, reserved.version);
  const confirmed = await funding.confirm(reserved.key, hold('ORDER-SAVED'));
  expect(confirmed).toMatchObject({ status: 'HELD', orderId: 'ORDER-SAVED', approvalUrl: null });
  expect(confirmed.version).toBe(creating.version + 1);
  expect(await funding.confirm(reserved.key, hold('ORDER-SAVED'))).toEqual(confirmed);
  await store.revoke('buyer', held.input.key);
  expect(await store.tokenFor(reserved.instruction)).toBeNull();

  const declined = await signed();
  const refused = await reserve(declined.draft);
  await funding.beginCreate(refused.key, refused.version);
  expect(await funding.fail(refused.key, 'debug-declined')).toMatchObject({
    status: 'FAILED',
    reference: 'debug-declined',
  });

  // Without a signed mandate nothing skips approval, in the store or the database.
  const plain = await setup();
  const unsigned = await reserve(plain.draft);
  expect(unsigned.instruction.source).toBeUndefined();
  await funding.beginCreate(unsigned.key, unsigned.version);
  await expect(funding.confirm(unsigned.key, hold('ORDER-PLAIN'))).rejects.toThrow('CONFLICT');
  await expect(funding.fail(unsigned.key, 'debug')).rejects.toThrow('CONFLICT');
  await expect(
    pool.query("UPDATE funding_operations SET status = 'AWAITING_APPROVAL', order_id = 'X' WHERE key = $1", [
      unsigned.key,
    ]),
  ).rejects.toThrow();
});

// T-0227: a saved token is a standing permission to charge the buyer. It is sealed in the row and in the
// append-only history, opens only through the store, and survives key rotation.
it('seals the saved token at rest and in history, refuses a second mandate for it, and rotates keys', async () => {
  const signed = async () => {
    const value = await tokenizing();
    const r = receipt(value.input.key);
    const token = {
      setupId: r.setupId,
      customerId: r.customerId,
      payerId: 'PAYER',
      tokenId: `SECRET-${value.input.key}`,
    };
    return { key: value.input.key, token, mandate: await store.confirm(value.input.key, token) };
  };
  const { key, token, mandate } = await signed();
  expect(mandate.tokenId).toBe(token.tokenId);
  const raw = async () =>
    (await pool.query('SELECT token_id, token_fingerprint FROM mandate_signatures WHERE key = $1', [key])).rows[0];
  const stored = await raw();
  expect(stored.token_id).toMatch(/^v1\./);
  expect(stored.token_id).not.toContain('SECRET-');
  expect(stored.token_fingerprint).toBe(cipher.fingerprint(token.tokenId));
  const history = await pool.query('SELECT snapshot::text AS s FROM mandate_events WHERE key = $1', [key]);
  expect(history.rows.length).toBeGreaterThan(3);
  expect(history.rows.some((row) => row.s.includes('SECRET-'))).toBe(false);
  expect((await store.load(key)).tokenId).toBe(token.tokenId);
  expect(await store.confirm(key, token)).toMatchObject({ status: 'SIGNED', tokenId: token.tokenId });
  // The same PayPal token can back only one mandate.
  const other = await tokenizing();
  const r = receipt(other.input.key);
  await expect(
    store.confirm(other.input.key, {
      setupId: r.setupId,
      customerId: r.customerId,
      payerId: 'PAYER',
      tokenId: token.tokenId,
    }),
  ).rejects.toThrow();
  await expect(
    pool.query('UPDATE mandate_signatures SET token_fingerprint = $1, version = version + 1 WHERE key = $2', [
      'f'.repeat(64),
      key,
    ]),
  ).rejects.toThrow();

  const rotated = new PostgresMandates(db, new TokenCipher(`${v2},${v1}`));
  expect(await rotated.rotateTokens()).toBeGreaterThanOrEqual(1);
  expect((await raw()).token_id).toMatch(/^v2\./);
  expect((await raw()).token_fingerprint).toBe(stored.token_fingerprint);
  expect((await rotated.load(key)).tokenId).toBe(token.tokenId);
  expect(await rotated.rotateTokens()).toBe(0);
  const rehistory = await pool.query('SELECT snapshot::text AS s FROM mandate_events WHERE key = $1', [key]);
  expect(rehistory.rows.some((row) => row.s.includes('SECRET-'))).toBe(false);
  // A store without the new key fails closed rather than handing out anything.
  await expect(store.load(key)).rejects.toThrow('Token cannot be opened');
});
