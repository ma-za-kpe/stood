import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { codeParams } from '../../../test/fixtures/code-terms.js';
import { decide, getProfile } from '../../domain/decision.js';
import { PostgresCommitPackages } from './commit-packages.js';
import { PostgresPlatformApi } from './platform-api.js';
import { PostgresRunnerJobs } from './runner-jobs.js';
import * as schema from './schema.js';
import { PostgresTranches } from './tranches.js';
import { PostgresUsageReceipts } from './usage-receipts.js';

const name = `test_runner_jobs_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const pool = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
const db = drizzle(pool, { schema });
const at = 1790985600000;
const metadata = (commit: string) => ({
  repository: codeParams.repository,
  base_commit: codeParams.baseCommit,
  commit_sha: commit,
  report_ref: 'reports/package.json',
  report_sha256: 'c'.repeat(64),
});
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});

// T-0159: the runner's queue is the latest package of each held code tranche, with the terms the buyer signed (never
// the package's own claims) and the commits submitted before it. A decided package leaves the queue.
it('lists the latest package of each held code tranche with its signed terms, until it is decided', async () => {
  const draft = await new PostgresPlatformApi(db).create('platform_a', randomUUID(), 'd'.repeat(64), {
    payee_ref: 'builder',
    cap: { minor: 3000, currency: 'USD' },
    milestones: [
      { name: 'one', amount: { minor: 1000, currency: 'USD' }, profile: 'code.milestone@1', params: codeParams },
      { name: 'two', amount: { minor: 2000, currency: 'USD' }, profile: 'code.final@1', params: codeParams },
    ],
    window_days: 7,
    max_resubmits: 1,
  });
  const [one, two] = draft.tranches.map((t) => t.id) as [string, string];
  const tranches = new PostgresTranches(db);
  await tranches.apply(one, 0, 'dispatch', { method: 'dispatch', args: ['auth', 'K7Q', at, at + 28 * 86400000] });
  const packages = new PostgresCommitPackages(db);
  const first = await packages.submit('platform_a', one, 'first', 'a'.repeat(64), metadata('b'.repeat(40)));
  const latest = await packages.submit('platform_a', one, 'second', 'b'.repeat(64), metadata('e'.repeat(40)));
  await packages.submit('platform_a', two, 'not-held', 'c'.repeat(64), metadata('f'.repeat(40)));
  const jobs = new PostgresRunnerJobs(db);
  expect(await jobs.pending()).toEqual([
    {
      platformId: 'platform_a',
      allowanceId: draft.id,
      trancheId: one,
      packageId: latest.id,
      profileId: 'code.milestone@1',
      amount: { minor: 1000, currency: 'USD' },
      terms: { ...codeParams, minMutation: 0 },
      package: { repository: codeParams.repository, baseCommit: codeParams.baseCommit, commit: 'e'.repeat(40) },
      priorCommits: ['b'.repeat(40)],
    },
  ]);
  const held = await tranches.load(one);
  // Audit 2026-10-10, finding 5: a decision on a superseded package is refused under the submission lock.
  await expect(
    tranches.applyIfLatest(one, held.version, 'stale', { method: 'startDeciding', args: [] }, first.id),
  ).rejects.toThrow('STALE_PACKAGE');
  const started = await tranches.applyIfLatest(
    one,
    held.version,
    'start',
    { method: 'startDeciding', args: [] },
    latest.id,
  );
  // A run that stopped after starting to decide stays queued, so it is decided again.
  expect((await jobs.pending()).map((j) => j.packageId)).toEqual([latest.id]);
  await tranches.applyIfLatest(
    one,
    started.version,
    `run:${latest.id}`,
    { method: 'beginSettlement', args: [decide('code.milestone@1', []), `run:${latest.id}`, at + 1] },
    latest.id,
  );
  expect(await jobs.pending()).toEqual([]);
});

// C4 (#77): a final milestone that waited only for usage returns to the queue once a verified receipt exists for
// its package's commit, and leaves it when decided again.
it('queues a waiting final milestone again once its use is confirmed for that commit', async () => {
  const draft = await new PostgresPlatformApi(db).create('platform_u', randomUUID(), 'd'.repeat(64), {
    payee_ref: 'builder',
    cap: { minor: 1000, currency: 'USD' },
    milestones: [
      { name: 'final', amount: { minor: 1000, currency: 'USD' }, profile: 'code.final@1', params: codeParams },
    ],
    window_days: 7,
    max_resubmits: 1,
  });
  const [final] = draft.tranches.map((t) => t.id) as [string];
  const tranches = new PostgresTranches(db);
  await tranches.apply(final, 0, 'dispatch', { method: 'dispatch', args: ['auth-u', 'K7R', at, at + 28 * 86400000] });
  const pkg = await new PostgresCommitPackages(db).submit(
    'platform_u',
    final,
    'only',
    'a'.repeat(64),
    metadata('e'.repeat(40)),
  );
  const held = await tranches.load(final);
  const started = await tranches.apply(final, held.version, 'start', { method: 'startDeciding', args: [] });
  const passing = getProfile('code.final@1')
    .checks.filter(({ code }) => code !== 'usage_release')
    .map(({ code }) => ({ code, source: 'RULE' as const, status: 'PASS' as const, reason: 'ok' }));
  await tranches.apply(final, started.version, `run:${pkg.id}`, {
    method: 'beginSettlement',
    args: [decide('code.final@1', passing), `run:${pkg.id}`, at + 1],
  });
  const jobs = new PostgresRunnerJobs(db);
  const mine = async () => (await jobs.pending(50)).filter((j) => j.trancheId === final);
  expect(await mine()).toEqual([]);
  const usage = new PostgresUsageReceipts(db);
  const receipt = {
    version: 1 as const,
    allowanceId: draft.id,
    trancheId: final,
    commit: 'f'.repeat(40),
    authority: { keyId: 'yard-usage-1', root: 'yard-buyers' },
    observedAt: at,
    nonce: `nonce-${randomUUID()}`,
    signature: 'c2lnbmVk',
  };
  // A receipt for another commit does not count.
  await usage.record('platform_u', receipt);
  expect(await mine()).toEqual([]);
  await usage.record('platform_u', { ...receipt, commit: 'e'.repeat(40), nonce: `nonce-${randomUUID()}` });
  expect(await mine()).toEqual([expect.objectContaining({ packageId: pkg.id, usageConfirmed: true })]);
  const waiting = await tranches.load(final);
  await tranches.apply(final, waiting.version, `usage:${pkg.id}`, {
    method: 'beginSettlement',
    args: [
      decide('code.final@1', [...passing, { code: 'usage_release', source: 'RULE', status: 'PASS', reason: 'ok' }]),
      `usage:${pkg.id}`,
      at + 2,
    ],
  });
  expect(await mine()).toEqual([]);
});

// C4 (#77): the usage store finds the latest package's commit for a tranche its platform owns, and keeps each nonce once.
it('stores verified usage once per nonce and finds it by tranche and commit', async () => {
  const draft = await new PostgresPlatformApi(db).create('platform_v', randomUUID(), 'd'.repeat(64), {
    payee_ref: 'builder',
    cap: { minor: 1000, currency: 'USD' },
    milestones: [
      { name: 'final', amount: { minor: 1000, currency: 'USD' }, profile: 'code.final@1', params: codeParams },
    ],
    window_days: 7,
    max_resubmits: 1,
  });
  const [final] = draft.tranches.map((t) => t.id) as [string];
  const usage = new PostgresUsageReceipts(db);
  expect(await usage.target('platform_v', final)).toBeNull();
  await new PostgresTranches(db).apply(final, 0, 'dispatch', {
    method: 'dispatch',
    args: ['auth-v', 'K7S', at, at + 28 * 86400000],
  });
  await new PostgresCommitPackages(db).submit('platform_v', final, 'p', 'a'.repeat(64), metadata('e'.repeat(40)));
  expect(await usage.target('platform_v', final)).toEqual({ allowanceId: draft.id, commit: 'e'.repeat(40) });
  expect(await usage.target('platform_other', final)).toBeNull();
  const receipt = {
    version: 1 as const,
    allowanceId: draft.id,
    trancheId: final,
    commit: 'e'.repeat(40),
    authority: { keyId: 'k', root: 'r' },
    observedAt: at,
    nonce: `nonce-${randomUUID()}`,
    signature: 'c2lnbmVk',
  };
  const stored = await usage.record('platform_v', receipt);
  expect(stored).toMatchObject({ trancheId: final, commit: 'e'.repeat(40), nonce: receipt.nonce });
  expect(await usage.byNonce(receipt.nonce)).toEqual({ usage: stored, receipt });
  expect(await usage.byNonce('nonce-unknown-000000')).toBeNull();
  expect(await usage.find(final, 'e'.repeat(40))).toEqual(stored);
  expect(await usage.find(final, 'f'.repeat(40))).toBeNull();
  await expect(usage.record('platform_v', receipt)).rejects.toThrow('REPLAYED');
});
