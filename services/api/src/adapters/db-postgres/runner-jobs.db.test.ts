import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { codeParams } from '../../../test/fixtures/code-terms.js';
import { decide } from '../../domain/decision.js';
import { PostgresCommitPackages } from './commit-packages.js';
import { PostgresPlatformApi } from './platform-api.js';
import { PostgresRunnerJobs } from './runner-jobs.js';
import * as schema from './schema.js';
import { PostgresTranches } from './tranches.js';

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
  await packages.submit('platform_a', one, 'first', 'a'.repeat(64), metadata('b'.repeat(40)));
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
  const started = await tranches.apply(one, held.version, 'start', { method: 'startDeciding', args: [] });
  await tranches.apply(one, started.version, `run:${latest.id}`, {
    method: 'beginSettlement',
    args: [decide('code.milestone@1', []), `run:${latest.id}`, at + 1],
  });
  expect(await jobs.pending()).toEqual([]);
});
