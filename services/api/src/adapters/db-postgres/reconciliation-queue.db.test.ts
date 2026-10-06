import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reconciliationTick } from '../../application/reconciliation-worker.js';
import { createTrancheRecord } from '../../domain/tranche-record.js';
import { PostgresReconciliationQueue } from './reconciliation-queue.js';
import * as schema from './schema.js';
import { PostgresTranches } from './tranches.js';

const name = `test_reconciliation_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const pool = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
const db = drizzle(pool, { schema });
const store = new PostgresTranches(db);
const queue = new PostgresReconciliationQueue(pool);
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});
describe('Durable reconciliation jobs and owned alerts', () => {
  it('serializes claims, prevents stale completion and recovers an expired lease', async () => {
    for (const id of ['queue_a', 'queue_b'])
      await store.create(
        createTrancheRecord({
          id,
          amount: { minor: 1000, currency: 'GBP' },
          profileId: 'construction.stage@1',
          maxResubmits: 1,
        }),
      );
    await queue.seed();
    const jobs = await Promise.all([queue.claim(), queue.claim()]);
    expect(new Set(jobs.map((job) => job?.trancheId)).size).toBe(2);
    expect(await queue.claim()).toBeNull();
    const first = jobs[0];
    if (!first) throw new Error('Missing lease');
    await queue.finish({ ...first, token: randomUUID() }, 0);
    expect(await queue.claim()).toBeNull();
    await pool.query(
      "UPDATE reconciliation_jobs SET leased_until = clock_timestamp() - interval '1 minute' WHERE tranche_id = $1",
      [first.trancheId],
    );
    const reclaimed = await queue.claim();
    expect(reclaimed?.token).not.toBe(first.token);
    await queue.finish(first, 0);
    expect(await queue.claim()).toBeNull();
    for (const job of [reclaimed, jobs[1]]) if (job) await queue.finish(job, 3600);
  });
  it('stores the consumed capture-retry alert after migration 0016 and still rejects unknown codes (T-0158)', async () => {
    await queue.alert({ trancheId: 'queue_b', operationKey: 'op', code: 'CAPTURE_RETRY_CONSUMED', owner: 'reviewer' });
    const rows = (await pool.query('SELECT code, status FROM payment_alerts WHERE tranche_id = $1', ['queue_b'])).rows;
    expect(rows).toContainEqual({ code: 'CAPTURE_RETRY_CONSUMED', status: 'OPEN' });
    await expect(
      queue.alert({ trancheId: 'queue_b', operationKey: null, code: 'MADE_UP' as never, owner: 'reviewer' }),
    ).rejects.toThrow();
  });
  it('deduplicates alerts while retaining opened time and resolved rows across connection restarts', async () => {
    const alert = { trancheId: 'queue_a', operationKey: null, code: 'PROVIDER_UNKNOWN' as const, owner: 'reviewer' };
    await queue.alert(alert);
    const before = (await pool.query('SELECT * FROM payment_alerts WHERE tranche_id = $1', ['queue_a'])).rows[0];
    const restarted = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
    try {
      await new PostgresReconciliationQueue(restarted).alert(alert);
    } finally {
      await restarted.end();
    }
    const after = (await pool.query('SELECT * FROM payment_alerts WHERE tranche_id = $1', ['queue_a'])).rows;
    expect(after).toHaveLength(1);
    expect(after[0].opened_at).toEqual(before.opened_at);
    expect(after[0].owner).toBe('reviewer');
    await queue.resolve('queue_a');
    expect(
      (await pool.query('SELECT status FROM payment_alerts WHERE tranche_id = $1', ['queue_a'])).rows[0].status,
    ).toBe('RESOLVED');
    await expect(queue.alert({ ...alert, owner: '' })).rejects.toThrow();
  });
  it('sets alert observation times on the server and prevents rewriting identity or opened time', async () => {
    await pool.query(
      "INSERT INTO payment_alerts (id, tranche_id, code, owner, opened_at, last_seen_at) VALUES ('clock_alert', 'queue_a', 'WORKER_FAILURE', 'reviewer', '2000-01-01', '2000-01-01')",
    );
    const row = (await pool.query("SELECT * FROM payment_alerts WHERE id = 'clock_alert'")).rows[0];
    expect(row.opened_at.getUTCFullYear()).toBeGreaterThan(2020);
    await expect(
      pool.query("UPDATE payment_alerts SET opened_at = '2000-01-01' WHERE id = 'clock_alert'"),
    ).rejects.toThrow();
    await expect(
      pool.query("UPDATE payment_alerts SET code = 'PROVIDER_UNKNOWN' WHERE id = 'clock_alert'"),
    ).rejects.toThrow();
    await pool.query("UPDATE payment_alerts SET last_seen_at = '2000-01-01' WHERE id = 'clock_alert'");
    expect(
      (
        await pool.query("SELECT last_seen_at FROM payment_alerts WHERE id = 'clock_alert'")
      ).rows[0].last_seen_at.getUTCFullYear(),
    ).toBeGreaterThan(2020);
    await expect(queue.finish({ trancheId: 'queue_a', token: randomUUID() }, -1)).rejects.toThrow();
  });
  it('reserves old-rule cancellation automatically and persists the reviewer as its owner', async () => {
    await store.create(readFileSync(new URL('../../domain/fixtures/old-rule-held.json', import.meta.url), 'utf8'));
    const now = Date.now() + 4 * 3600000;
    expect(
      await reconciliationTick(store, { read: async () => null }, queue, { owner: 'local-reviewer', clock: () => now }),
    ).toMatchObject({ processed: 1, waiting: 1 });
    expect((await store.load('trn_old')).pending?.operation).toMatchObject({ effect: 'VOID', target: 'CANCELLED' });
    const alerts = (await pool.query('SELECT code, owner FROM payment_alerts WHERE tranche_id = $1', ['trn_old'])).rows;
    expect(alerts).toContainEqual({ code: 'SAFE_CANCEL_REQUESTED', owner: 'local-reviewer' });
    expect(alerts).toContainEqual({ code: 'UNRESOLVED_3H', owner: 'local-reviewer' });
  });
});
