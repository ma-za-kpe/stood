import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PostgresOperationsAttention } from './operations-attention.js';
import { PostgresReconciliationFindings } from './reconciliation-findings.js';
import * as schema from './schema.js';

const name = `test_attention_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Pool({ connectionString: 'postgres://stood:stood_local_only@db:5432/stood' });
const pool = new pg.Pool({ connectionString: `postgres://stood:stood_local_only@db:5432/${name}` });
const db = drizzle(pool, { schema });
beforeAll(async () => {
  await admin.query(`CREATE DATABASE ${name}`);
  await migrate(db, { migrationsFolder: resolve('services/api/drizzle') });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE ${name}`);
  await admin.end();
});

it('counts open findings and open payment alerts, and forgets them once a person resolves them (T-0155)', async () => {
  const attention = new PostgresOperationsAttention(db);
  expect(await attention.read()).toEqual({ openFindings: 0, openAlerts: 0, oldestOpenedAt: null });
  const findings = new PostgresReconciliationFindings(db);
  await findings.record(
    [{ kind: 'CAPTURE_WITHOUT_RELEASE', trancheId: null, providerId: 'CAP-1', operationKey: null }],
    'reviewer',
  );
  await pool.query("INSERT INTO payment_streams (tranche_id) VALUES ('t-alert')");
  await pool.query(
    "INSERT INTO payment_alerts (id, tranche_id, operation_key, code, owner) VALUES ('a1', 't-alert', 'op', 'UNRESOLVED_3H', 'reviewer')",
  );
  const seen = await attention.read();
  expect(seen).toMatchObject({ openFindings: 1, openAlerts: 1 });
  expect(Date.parse(seen.oldestOpenedAt ?? '')).toBeGreaterThan(0);
  const [open] = await findings.open();
  await findings.resolveByPerson(open?.id ?? '', 'Maya', 'operator tool capture');
  await pool.query("UPDATE payment_alerts SET status = 'RESOLVED'");
  expect(await attention.read()).toEqual({ openFindings: 0, openAlerts: 0, oldestOpenedAt: null });
});
