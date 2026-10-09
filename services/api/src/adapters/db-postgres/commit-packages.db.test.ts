import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CommitPackageError } from '../../ports/commit-package-store.js';
import { PostgresCommitPackages } from './commit-packages.js';
import { PostgresPlatformApi } from './platform-api.js';
import * as schema from './schema.js';
import { PostgresTranches } from './tranches.js';

const name = `test_commit_packages_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const connectionString = `postgres://stood:stood_local_only@db:5432/${name}`;
const pool = new pg.Pool({ connectionString });
const db = drizzle(pool, { schema });
const store = new PostgresCommitPackages(db);
const metadata = {
  repository: 'owner/repo',
  base_commit: 'a'.repeat(40),
  commit_sha: 'b'.repeat(40),
  report_ref: 'reports/package.json',
  report_sha256: 'c'.repeat(64),
};
const at = 1790985600000;
async function tranche(profile = 'code.milestone@1') {
  const draft = await new PostgresPlatformApi(db).create('platform_a', randomUUID(), 'd'.repeat(64), {
    payee_ref: 'operator',
    cap: { minor: 120000, currency: 'USD' },
    milestones: [{ name: 'build', amount: { minor: 120000, currency: 'USD' }, profile, params: {} }],
    window_days: 7,
    max_resubmits: 1,
  });
  return draft.tranches[0]?.id as string;
}
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
describe('Durable commit-package references without execution (T-0172)', () => {
  it('serialises identical intake and replays the same immutable response after restart', async () => {
    const id = await tranche();
    const results = await Promise.all([
      store.submit('platform_a', id, 'same', 'a'.repeat(64), metadata),
      store.submit('platform_a', id, 'same', 'a'.repeat(64), metadata),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ status: 'QUEUED', waitingFor: 'HOLD', metadata });
    const restartedPool = new pg.Pool({ connectionString });
    try {
      const restarted = new PostgresCommitPackages(drizzle(restartedPool, { schema }));
      expect(await restarted.submit('platform_a', id, 'same', 'a'.repeat(64), metadata)).toEqual(results[0]);
      expect(await restarted.get('platform_a', id, results[0]!.id)).toEqual(results[0]);
    } finally {
      await restartedPool.end();
    }
  });
  it('rejects changed metadata or request fingerprints with no additional row', async () => {
    const id = await tranche();
    await store.submit('platform_a', id, 'same', 'a'.repeat(64), metadata);
    for (const [fingerprint, body] of [
      ['b'.repeat(64), metadata],
      ['a'.repeat(64), { ...metadata, commit_sha: 'd'.repeat(40) }],
    ] as const)
      await expect(store.submit('platform_a', id, 'same', fingerprint, body)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    expect((await pool.query('SELECT * FROM commit_packages WHERE tranche_id=$1', [id])).rows).toHaveLength(1);
  });
  // T-0189: the tranche view names the package Stood is judging, the latest one submitted; never a foreign one.
  it('reads the latest package for a tranche and nothing for another platform', async () => {
    const id = await tranche();
    expect(await store.latest('platform_a', id)).toBeNull();
    await store.submit('platform_a', id, 'first', 'a'.repeat(64), metadata);
    const second = await store.submit('platform_a', id, 'second', 'b'.repeat(64), {
      ...metadata,
      commit_sha: 'e'.repeat(40),
    });
    expect((await store.latest('platform_a', id))?.id).toBe(second.id);
    expect(await store.latest('platform_b', id)).toBeNull();
  });
  it('hides absent and foreign tranches and packages without disclosing metadata', async () => {
    const id = await tranche();
    const item = await store.submit('platform_a', id, 'own', 'a'.repeat(64), metadata);
    for (const target of [id, 'missing'])
      await expect(store.submit('platform_b', target, 'foreign', 'a'.repeat(64), metadata)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    expect(await store.get('platform_b', id, item.id)).toBeNull();
    expect(await store.get('platform_a', id, 'missing')).toBeNull();
  });
  it('durably queues evidence during a renewal without touching the operation or losing it', async () => {
    const id = await tranche();
    const tranches = new PostgresTranches(db);
    let snapshot = await tranches.apply(id, 0, 'dispatch', {
      method: 'dispatch',
      args: ['auth', 'K7Q', at, at + 29 * 86400000],
    });
    snapshot = await tranches.apply(id, snapshot.version, 'renew', {
      method: 'beginReauthorization',
      args: [at + 3 * 86400000],
    });
    const item = await store.submit('platform_a', id, 'during-renewal', 'a'.repeat(64), metadata);
    expect(item.waitingFor).toBe('RENEWAL');
    expect(await tranches.load(id)).toEqual(snapshot);
    expect(await new PostgresCommitPackages(db).get('platform_a', id, item.id)).toEqual(item);
  });
  it('queues held packages for a trusted runner and rejects terminal/field profiles', async () => {
    const id = await tranche();
    const tranches = new PostgresTranches(db);
    await tranches.apply(id, 0, 'dispatch', { method: 'dispatch', args: ['auth', 'K7Q', at, at + 29 * 86400000] });
    expect((await store.submit('platform_a', id, 'held', 'a'.repeat(64), metadata)).waitingFor).toBe('RUNNER');
    await tranches.apply(id, 1, 'expire', { method: 'expire', args: [at + 29 * 86400000] });
    await expect(store.submit('platform_a', id, 'pending-void', 'a'.repeat(64), metadata)).rejects.toMatchObject({
      code: 'INVALID_PACKAGE',
    });
    await expect(
      store.submit('platform_a', await tranche('construction.stage@1'), 'field', 'a'.repeat(64), metadata),
    ).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
  });
  it('enforces immutable metadata, server timestamps and ownership in Postgres', async () => {
    const id = await tranche();
    const item = await store.submit('platform_a', id, 'immutable', 'a'.repeat(64), metadata);
    await expect(pool.query('UPDATE commit_packages SET metadata=$1 WHERE id=$2', [{}, item.id])).rejects.toThrow();
    await expect(pool.query('DELETE FROM commit_packages WHERE id=$1', [item.id])).rejects.toThrow();
    await expect(
      pool.query(
        "INSERT INTO commit_packages (id,platform_id,tranche_id,key,fingerprint,metadata,waiting_for) VALUES ('bad','foreign',$1,'key',$2,$3,'HOLD')",
        [id, 'a'.repeat(64), metadata],
      ),
    ).rejects.toThrow();
    expect(Number.isFinite(Date.parse(item.createdAt))).toBe(true);
    const inserted = await pool.query(
      "INSERT INTO commit_packages (id,platform_id,tranche_id,key,fingerprint,metadata,waiting_for,created_at) VALUES ('clock','platform_a',$1,'clock',$2,$3,'HOLD','2000-01-01') RETURNING created_at",
      [id, 'a'.repeat(64), metadata],
    );
    expect(new Date(inserted.rows[0].created_at).getUTCFullYear()).not.toBe(2000);
    await expect(pool.query('TRUNCATE commit_packages')).rejects.toThrow();
    await expect(store.submit('platform_a', id, '', 'bad', metadata)).rejects.toBeInstanceOf(CommitPackageError);
  });
});

describe('Packages queued during renewal wake up from durable state (T-0137)', () => {
  const tranches = new PostgresTranches(db);
  const apply = async (id: string, key: string, command: Parameters<PostgresTranches['apply']>[3]) =>
    tranches.apply(id, (await tranches.load(id)).version, key, command);
  const day = 86400000;
  it('keeps evidence queued through an ambiguous renewal and releases it to the runner after confirmation', async () => {
    const id = await tranche();
    await apply(id, 'dispatch', { method: 'dispatch', args: ['auth_1', 'K7Q', at, at + 29 * day] });
    await apply(id, 'renew', { method: 'beginReauthorization', args: [at + 4 * day] });
    const receipt = await store.submit('platform_a', id, 'mid-renewal', 'a'.repeat(64), metadata);
    expect(receipt.waitingFor).toBe('RENEWAL');
    const pending = (await tranches.load(id)).pending;
    if (!pending) throw new Error('missing renewal operation');
    await apply(id, 'ambiguous', {
      method: 'reauthorizationFailed',
      args: [{ effect: 'REAUTHORIZE', key: pending.operation.key, authorizationId: 'auth_1', kind: 'AMBIGUOUS' }],
    });
    expect((await store.get('platform_a', id, receipt.id))?.waitingFor).toBe('RENEWAL');
    await apply(id, 'renewed', {
      method: 'confirmReauthorization',
      args: [
        {
          effect: 'REAUTHORIZE',
          key: pending.operation.key,
          previousAuthorizationId: 'auth_1',
          authorizationId: 'auth_2',
          confirmedAt: at + 4 * day,
          expiresAt: at + 29 * day,
        },
      ],
    });
    const restartedPool = new pg.Pool({ connectionString });
    try {
      const restarted = new PostgresCommitPackages(drizzle(restartedPool, { schema }));
      expect((await restarted.get('platform_a', id, receipt.id))?.waitingFor).toBe('RUNNER');
      // The intake receipt itself is immutable and replays exactly.
      expect(await restarted.submit('platform_a', id, 'mid-renewal', 'a'.repeat(64), metadata)).toEqual(receipt);
    } finally {
      await restartedPool.end();
    }
  });
  it('releases queued evidence after a rejected renewal, and returns to waiting for a hold once it lapses', async () => {
    const id = await tranche();
    await apply(id, 'dispatch', { method: 'dispatch', args: ['auth_1', 'K7Q', at, at + 29 * day] });
    await apply(id, 'renew', { method: 'beginReauthorization', args: [at + 4 * day] });
    const receipt = await store.submit('platform_a', id, 'queued', 'a'.repeat(64), metadata);
    const pending = (await tranches.load(id)).pending;
    if (!pending) throw new Error('missing renewal operation');
    await apply(id, 'rejected', {
      method: 'reauthorizationFailed',
      args: [
        {
          effect: 'REAUTHORIZE',
          key: pending.operation.key,
          authorizationId: 'auth_1',
          kind: 'REJECTED_NO_REAUTHORIZATION',
          reference: 'provider-no-renewal',
        },
      ],
    });
    expect((await store.get('platform_a', id, receipt.id))?.waitingFor).toBe('RUNNER');
    await apply(id, 'expire', { method: 'expire', args: [at + 29 * day] });
    expect((await store.get('platform_a', id, receipt.id))?.waitingFor).toBe('HOLD');
  });
});
