import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codeParams } from '../../../test/fixtures/code-terms.js';
import { PostgresAllowanceVersions } from './allowance-versions.js';
import { PostgresCommitPackages } from './commit-packages.js';
import { PostgresFunding } from './funding.js';
import { mandateTermsHash, PostgresMandates } from './mandates.js';
import { PostgresPlatformApi } from './platform-api.js';
import { PostgresRunnerJobs } from './runner-jobs.js';
import * as schema from './schema.js';
import { TokenCipher } from './token-cipher.js';
import { PostgresUploads } from './uploads.js';

const name = `test_versions_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const connectionString = `postgres://stood:stood_local_only@db:5432/${name}`;
const pool = new pg.Pool({ connectionString });
const db = drizzle(pool, { schema });
const drafts = new PostgresPlatformApi(db);
const versions = new PostgresAllowanceVersions(db);
const input = {
  payee_ref: 'builder',
  cap: { minor: 2000, currency: 'GBP' },
  milestones: ['one', 'two'].map((name) => ({
    name,
    amount: { minor: 1000, currency: 'GBP' },
    profile: 'construction.stage@1',
    params: { stage: 'foundation' },
  })),
  window_days: 7,
  max_resubmits: 1,
};
const proposal = (stage: string, index = 0) => ({
  ...input,
  milestones: input.milestones.map((m, i) => (i === index ? { ...m, params: { stage } } : m)),
});
const draft = () => drafts.create('owner', randomUUID(), 'a'.repeat(64), input);
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
describe('immutable allowance versions', () => {
  it('retains version one and tranche identities; replay precedes the latest-version check after restart', async () => {
    const original = await draft();
    const value = proposal('roof');
    const second = await versions.propose('owner', original.id, 'same-key', 1, value);
    expect(second).toEqual({ version: 2, body: { ...original, ...value } });
    expect(await versions.read('owner', original.id, 1)).toEqual({ version: 1, body: original });
    await versions.propose('owner', original.id, 'next', 2, proposal('walls'));
    const restart = new pg.Pool({ connectionString });
    try {
      expect(
        await new PostgresAllowanceVersions(drizzle(restart, { schema })).propose(
          'owner',
          original.id,
          'same-key',
          1,
          value,
        ),
      ).toEqual(second);
    } finally {
      await restart.end();
    }
    await expect(versions.propose('owner', original.id, 'same-key', 1, proposal('different'))).rejects.toThrow(
      'IDEMPOTENCY_CONFLICT',
    );
    await expect(pool.query('UPDATE allowance_versions SET body = $1', [JSON.stringify(original)])).rejects.toThrow();
    await expect(pool.query('TRUNCATE allowance_versions')).rejects.toThrow();
  });
  it('serializes competing proposals and refuses stale or cross-tenant access without leaking terms', async () => {
    const original = await draft();
    const results = await Promise.allSettled([
      versions.propose('owner', original.id, 'a', 1, proposal('roof')),
      versions.propose('owner', original.id, 'b', 1, proposal('walls')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    await expect(versions.propose('other', original.id, 'a', 1, proposal('roof'))).rejects.toThrow('NOT_FOUND');
    expect(await versions.read('other', original.id)).toBeNull();
    expect(await versions.read('owner', original.id, 99)).toBeNull();
  });
  it('rolls back a successor when its receipt cannot be persisted', async () => {
    const original = await draft();
    await pool.query(
      "CREATE FUNCTION reject_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END; $$; CREATE TRIGGER reject_version BEFORE INSERT ON allowance_versions FOR EACH ROW EXECUTE FUNCTION reject_version()",
    );
    try {
      await expect(versions.propose('owner', original.id, 'failed', 1, proposal('roof'))).rejects.toThrow();
    } finally {
      await pool.query('DROP TRIGGER reject_version ON allowance_versions; DROP FUNCTION reject_version()');
    }
    expect(await versions.read('owner', original.id)).toEqual({ version: 1, body: original });
    expect((await versions.propose('owner', original.id, 'failed', 1, proposal('roof'))).version).toBe(2);
  });
  it('serializes a proposal against a funding reservation without deadlock', async () => {
    const original = await draft();
    const results = await Promise.allSettled([
      versions.propose('owner', original.id, 'race', 1, proposal('roof')),
      new PostgresFunding(db).reserve({
        key: randomUUID(),
        platformId: 'owner',
        trancheId: original.tranches[0]?.id ?? '',
        expectedVersion: 0,
        nonce: 'AB2',
        mode: 'sim',
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(String(failed.reason)).toMatch(/CONFLICT|Amendment changes funded work/);
  });
  it('fences any recorded funding intent while allowing changes to another unfunded milestone', async () => {
    const original = await draft();
    await new PostgresFunding(db).reserve({
      key: randomUUID(),
      platformId: 'owner',
      trancheId: original.tranches[0]?.id ?? '',
      expectedVersion: 0,
      nonce: 'AB2',
      mode: 'sim',
    });
    await expect(versions.propose('owner', original.id, 'blocked', 1, proposal('roof'))).rejects.toThrow(
      'Amendment changes funded work',
    );
    expect(await versions.read('owner', original.id)).toEqual({ version: 1, body: original });
    expect((await versions.propose('owner', original.id, 'permitted', 1, proposal('roof', 1))).version).toBe(2);
  });
});

it('binds new funding and runner terms to fresh consent while preserving an original reservation', async () => {
  const codeInput = {
    ...input,
    milestones: input.milestones.map((m) => ({ ...m, profile: 'code.milestone@1', params: codeParams })),
  };
  const original = await drafts.create('owner', randomUUID(), 'b'.repeat(64), codeInput);
  const mandates = new PostgresMandates(db, new TokenCipher(`v1:${randomBytes(32).toString('base64')}`));
  const funding = new PostgresFunding(db);
  const now = Date.parse('2026-10-13T08:00:00Z');
  const consent = async (version: number, body: typeof original) => {
    const key = randomUUID();
    await mandates.reserve({
      key,
      platformId: 'owner',
      allowanceId: original.id,
      termsVersion: version,
      termsHash: mandateTermsHash(body, version),
      mode: 'sim',
      acceptedAt: now,
    });
    await mandates.beginCreate(key, 0);
    await mandates.setupCreated(key, {
      setupId: `SETUP-${key}`,
      customerId: `CUSTOMER-${key}`,
      approvalUrl: `http://paypal-sim:8080/__sim/setup-approve/SETUP-${key}`,
    });
    await mandates.beginTokenize(key, 2, 'PAYER');
    return mandates.confirm(key, {
      setupId: `SETUP-${key}`,
      customerId: `CUSTOMER-${key}`,
      payerId: 'PAYER',
      tokenId: `TOKEN-${key}`,
    });
  };
  const firstConsent = await consent(1, original);
  const first = await funding.reserve({
    key: randomUUID(),
    platformId: 'owner',
    trancheId: original.tranches[0]?.id ?? '',
    expectedVersion: 0,
    nonce: 'AB2',
    mode: 'sim',
  });
  const nextInput = {
    ...codeInput,
    milestones: codeInput.milestones.map((m, i) =>
      i === 1 ? { ...m, params: { ...codeParams, minMutation: 0.8 } } : m,
    ),
  };
  const next = await versions.propose('owner', original.id, 'change-second', 1, nextInput);
  const secondInput = {
    key: randomUUID(),
    platformId: 'owner',
    trancheId: original.tranches[1]?.id ?? '',
    expectedVersion: 0,
    nonce: 'CD3',
    mode: 'sim' as const,
  };
  await expect(funding.reserve(secondInput)).rejects.toThrow('CONFLICT');
  await expect(
    mandates.reserve({
      key: randomUUID(),
      platformId: 'owner',
      allowanceId: original.id,
      termsVersion: 2,
      termsHash: mandateTermsHash(next.body),
      mode: 'sim',
      acceptedAt: now,
    }),
  ).rejects.toThrow('IDENTITY_CONFLICT');
  const secondConsent = await consent(2, next.body);
  const second = await funding.reserve(secondInput);
  expect(first.instruction).toMatchObject({ termsVersion: 1, mandateKey: firstConsent.key });
  expect(second.instruction).toMatchObject({ termsVersion: 2, mandateKey: secondConsent.key, source: 'SAVED_PAYPAL' });
  expect(await mandates.canFund(first.instruction, now + 1000)).toBe(true);
  expect(await mandates.canFund(second.instruction, now + 1000)).toBe(true);
  expect(await mandates.tokenFor(first.instruction)).toBe(firstConsent.tokenId);
  expect(await mandates.tokenFor(second.instruction)).toBe(secondConsent.tokenId);
  expect(await mandates.canFund({ ...second.instruction, termsVersion: 1 }, now + 1000)).toBe(false);
  const packages = new PostgresCommitPackages(db);
  for (const operation of [first, second]) {
    await funding.beginCreate(operation.key, 0);
    await funding.confirm(operation.key, {
      orderId: `ORDER-${operation.key}`,
      authorizationId: `AUTH-${operation.key}`,
      heldAt: now,
      expiresAt: now + 86400000,
      reference: 'qualified-hold',
    });
    await packages.submit('owner', operation.trancheId, randomUUID(), 'c'.repeat(64), {
      repository: codeParams.repository,
      base_commit: codeParams.baseCommit,
      commit_sha: 'e'.repeat(40),
      report_ref: 'reports/package.json',
      report_sha256: 'c'.repeat(64),
    });
  }
  const jobs = await new PostgresRunnerJobs(db).pending();
  expect(jobs.find((j) => j.trancheId === first.trancheId)?.terms.minMutation).toBe(0);
  expect(jobs.find((j) => j.trancheId === second.trancheId)?.terms.minMutation).toBe(0.8);
  await mandates.revoke('owner', firstConsent.key);
  expect(await mandates.canFund(first.instruction, now + 1000)).toBe(false);
  expect(await mandates.canFund(second.instruction, now + 1000)).toBe(true);
});

it('refuses to change terms after evidence intake even when no payment has been reserved', async () => {
  const original = await draft();
  await new PostgresUploads(db).reserve(
    'owner',
    original.tranches[0]?.id ?? '',
    'upload',
    'd'.repeat(64),
    [{ sha256: 'a'.repeat(64), bytes: 4, contentType: 'image/jpeg' }],
    Date.now(),
  );
  await expect(versions.propose('owner', original.id, 'after-upload', 1, proposal('roof'))).rejects.toThrow(
    'Amendment changes funded work',
  );
});
