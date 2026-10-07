import { createHmac, randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { MemoryEvents } from '../../test/fakes/events.js';
import { MemorySecretRows } from '../../test/fakes/secrets.js';
import { LocalKeyWrapper } from '../adapters/crypto/local-key-wrapper.js';
import { Board } from '../application/board.js';
import { SecretVault } from '../application/secret-vault.js';
import { createYardApp } from './app.js';

const now = 1791158400000;
function harness() {
  const events = new MemoryEvents();
  const board = new Board(events);
  const rows = new MemorySecretRows();
  const vault = new SecretVault(rows, new LocalKeyWrapper({ k1: randomBytes(32).toString('base64') }, 'k1'));
  const app = createYardApp({
    environment: 'ci',
    board: {
      board,
      clock: async () => now,
      secrets: vault,
      operators: [
        { key: 'buyer-key', secret: 'buyer-secret', actor: { id: 'buyer', root: 'buyer-root', kind: 'BUYER' } },
        { key: 'other-key', secret: 'other-secret', actor: { id: 'other', root: 'other-root', kind: 'BUYER' } },
        {
          key: 'builder-key',
          secret: 'builder-secret',
          actor: { id: 'builder', root: 'builder-root', kind: 'BUILDER' },
        },
      ],
    },
  });
  const request = async (path: string, method = 'GET', value?: unknown, version = 1, key = 'r', who = 'buyer') => {
    const raw = value === undefined ? '' : JSON.stringify(value),
      t = String(now / 1000);
    return app.request(path, {
      method,
      ...(raw ? { body: raw } : {}),
      headers: {
        'Yard-Key-Id': `${who}-key`,
        'Yard-Signature': `t=${t},v2=${createHmac('sha256', `${who}-secret`)
          .update(
            JSON.stringify([
              'yard.request@2',
              t,
              `${who}-key`,
              method,
              path,
              key,
              String(version),
              'application/json',
              '',
              raw,
            ]),
          )
          .digest('hex')}`,
        'Idempotency-Key': key,
        'Content-Type': 'application/json',
        'If-Match': String(version),
      },
    });
  };
  const milestones = ['one', 'two'].map((id, i) => ({
    id,
    name: id,
    budgetMinor: 1000,
    deadline: now + 86400000,
    profileId: i ? 'code.final@1' : 'code.milestone@1',
    testBundleHash: 'b'.repeat(64),
    manifestHash: 'c'.repeat(64),
    testIds: ['works'],
  }));
  const create = () =>
    request(
      '/yard/v1/blueprints',
      'POST',
      {
        id: 'p',
        buyerOperatorId: 'buyer',
        repository: 'buyer/project',
        baseCommit: 'a'.repeat(40),
        summary: 'Booking app',
        capMinor: 2000,
        currency: 'USD',
        milestones,
      },
      1,
      'create',
    );
  const sign = () =>
    request(
      '/yard/v1/blueprints/p/approve',
      'POST',
      {
        version: 1,
        buyerOperatorId: 'buyer',
        approvalReference: 'sim',
        baselines: milestones.map((m) => ({
          milestoneId: m.id,
          testBundleHash: m.testBundleHash,
          manifestHash: m.manifestHash,
          failedTestIds: m.testIds,
          reference: 'sim-red',
        })),
      },
      1,
      'freeze',
    );
  return { rows, events, request, create, sign };
}
const secret = { provider: 'supabase', environment: 'TEST', value: 'https://dev-project.supabase.co' };
const path = '/yard/v1/blueprints/p/secrets';

it('takes test keys only after signing, from the owning buyer, and never returns a value (T-0195)', async () => {
  const h = harness();
  expect((await h.create()).status).toBe(201);
  // Choices before credentials: an unsigned blueprint cannot receive keys.
  expect((await h.request(`${path}/SUPABASE_URL`, 'PUT', secret, 1, 'early')).status).toBe(409);
  expect((await h.sign()).status).toBe(200);
  for (const who of ['other', 'builder'])
    expect((await h.request(`${path}/SUPABASE_URL`, 'PUT', secret, 2, `x-${who}`, who)).status).toBe(403);
  const stored = await h.request(`${path}/SUPABASE_URL`, 'PUT', secret, 2, 'put-1');
  expect(stored.status).toBe(201);
  const body = await stored.json();
  expect(body).toMatchObject({ name: 'SUPABASE_URL', provider: 'supabase', environment: 'TEST', simulated: true });
  expect(JSON.stringify(body)).not.toContain('dev-project');
  expect((await h.request(`${path}/SUPABASE_URL`, 'PUT', secret, 2, 'put-1')).status).toBe(201);
  const listed = await (await h.request(path)).json();
  expect(listed.secrets).toHaveLength(1);
  expect(JSON.stringify(listed)).not.toContain('dev-project');
  expect((await h.request(path, 'GET', undefined, 1, 'r', 'builder')).status).toBe(403);
  // There is no route that reads a value back: these paths fall through to not_implemented.
  for (const target of [`${path}/SUPABASE_URL`, `${path}/SUPABASE_URL/value`]) {
    const response = await h.request(target);
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain('not_implemented');
    expect(text).not.toContain('dev-project');
  }
});

it('refuses live keys, unknown fields and production scope with fixed codes and stores nothing', async () => {
  const h = harness();
  await h.create();
  await h.sign();
  const live = await h.request(
    `${path}/STRIPE_KEY`,
    'PUT',
    { ...secret, provider: 'stripe', value: `sk_live_${'a'.repeat(24)}` },
    2,
    'live',
  );
  expect(live.status).toBe(422);
  expect(await live.json()).toEqual({ code: 'live_key_refused' });
  for (const [body, key] of [
    [{ ...secret, environment: 'PROD' }, 'prod'],
    [{ ...secret, extra: 'field' }, 'extra'],
    [{ provider: 'supabase', environment: 'TEST' }, 'missing'],
  ] as const)
    expect((await h.request(`${path}/SUPABASE_URL`, 'PUT', body, 2, key)).status).toBe(422);
  expect((await h.request(`${path}/lower_case`, 'PUT', secret, 2, 'bad-name')).status).toBe(422);
  expect(h.rows.dump()).toEqual([]);
});

it('revokes a key for the owner only and crypto-shreds it', async () => {
  const h = harness();
  await h.create();
  await h.sign();
  await h.request(`${path}/SUPABASE_URL`, 'PUT', secret, 2, 'put-1');
  expect((await h.request(`${path}/SUPABASE_URL/revoke`, 'POST', {}, 2, 'rv', 'other')).status).toBe(403);
  expect((await h.request(`${path}/SUPABASE_URL/revoke`, 'POST', {}, 2, 'rv')).status).toBe(200);
  expect((await h.request(`${path}/SUPABASE_URL/revoke`, 'POST', {}, 2, 'rv-2')).status).toBe(404);
  expect((await (await h.request(path)).json()).secrets).toEqual([]);
  expect(h.rows.dump().every((r) => r.ciphertext === '' && r.wrappedKey === '')).toBe(true);
});

it('records buyer-only secret metadata events with no value or fingerprint (T-0195, T-0194)', async () => {
  const h = harness();
  await h.create();
  await h.sign();
  await h.request(`${path}/SUPABASE_URL`, 'PUT', secret, 2, 'put-1');
  await h.request(`${path}/SUPABASE_URL`, 'PUT', secret, 2, 'put-1');
  await h.request(`${path}/SUPABASE_URL/revoke`, 'POST', {}, 2, 'rv');
  const log = await h.events.read('p', 0);
  const secrets = log.filter((e) => e.type.startsWith('secret.'));
  expect(secrets.map((e) => e.type)).toEqual(['secret.added', 'secret.revoked']);
  expect(secrets[0]?.payload).toEqual({
    name: 'SUPABASE_URL',
    provider: 'supabase',
    environment: 'TEST',
    version: 1,
    simulated: true,
  });
  expect(JSON.stringify(secrets)).not.toContain('dev-project');
  expect(JSON.stringify(secrets)).not.toMatch(/fingerprint/);
});
