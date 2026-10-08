import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PostgresProviderEvents } from './provider-events.js';
import * as schema from './schema.js';

const name = `test_provider_events_${randomUUID().replaceAll('-', '')}`;
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

it('stores each verified PayPal event once, as a hint, however often PayPal retries it (T-0033)', async () => {
  const events = new PostgresProviderEvents(db);
  const event = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-1' } };
  await events.enqueue(event);
  await events.enqueue(event);
  await events.enqueue({ ...event, resource: { id: 'CAP-CHANGED' } });
  const rows = await pool.query('SELECT event_id, event_type, resource, simulated FROM provider_events');
  expect(rows.rows).toEqual([
    { event_id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-1' }, simulated: false },
  ]);
  // Bounded fields: oversized identifiers are refused by the database itself.
  await expect(events.enqueue({ ...event, id: 'x'.repeat(201) })).rejects.toThrow();
});
