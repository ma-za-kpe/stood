import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresAllowanceVersions } from './allowance-versions.js';
import { PostgresFunding } from './funding.js';
import { PostgresPlatformApi } from './platform-api.js';
import * as schema from './schema.js';

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
    expect(results[1]?.status).toBe('fulfilled');
    if (results[0]?.status === 'rejected') expect(String(results[0].reason)).toContain('Amendment changes funded work');
    else expect(results[0]?.value.version).toBe(2);
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
