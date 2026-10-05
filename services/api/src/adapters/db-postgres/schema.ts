import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { TrancheCommand } from '../../domain/tranche-record.js';
import type { OperationIntent, OperationStatus } from '../../ports/payment-operation-store.js';
import type { OperationalAlert } from '../../ports/reconciliation-queue.js';

export const reconciliationJobs = pgTable('reconciliation_jobs', {
  trancheId: text('tranche_id')
    .primaryKey()
    .references(() => paymentStreams.trancheId),
  nextRunAt: timestamp('next_run_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`clock_timestamp()`),
  leaseToken: uuid('lease_token'),
  leasedUntil: timestamp('leased_until', { withTimezone: true, mode: 'string' }),
});
export const paymentAlerts = pgTable(
  'payment_alerts',
  {
    id: text().primaryKey(),
    trancheId: text('tranche_id')
      .notNull()
      .references(() => paymentStreams.trancheId),
    operationKey: text('operation_key'),
    code: text().$type<OperationalAlert['code']>().notNull(),
    owner: text().notNull(),
    status: text().notNull().default('OPEN'),
    openedAt: timestamp('opened_at', { withTimezone: true, mode: 'string' }).notNull().default(sql`clock_timestamp()`),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check('alert_owner_valid', sql`length(trim(${table.owner})) > 0`),
    check('alert_status_valid', sql`${table.status} IN ('OPEN', 'RESOLVED')`),
    check(
      'alert_code_valid',
      sql`${table.code} IN ('PROVIDER_UNKNOWN', 'UNRESOLVED_3H', 'SAFE_CANCEL_REQUESTED', 'WORKER_FAILURE')`,
    ),
  ],
);

export const paymentStreams = pgTable(
  'payment_streams',
  {
    trancheId: text('tranche_id').primaryKey(),
    version: integer().notNull().default(0),
    record: text(),
    initialRecord: text('initial_record'),
  },
  (table) => [
    check('stream_version_valid', sql`${table.version} >= 0`),
    check('stream_id_valid', sql`length(trim(${table.trancheId})) > 0`),
  ],
);

export const trancheCommands = pgTable(
  'tranche_commands',
  {
    trancheId: text('tranche_id')
      .notNull()
      .references(() => paymentStreams.trancheId),
    commandId: text('command_id').notNull(),
    version: integer().notNull(),
    command: jsonb().$type<TrancheCommand>().notNull(),
    record: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.trancheId, table.version] }),
    unique('tranche_command_identity').on(table.trancheId, table.commandId),
    check(
      'tranche_command_valid',
      sql`${table.version} > 0 AND length(trim(${table.commandId})) > 0 AND jsonb_typeof(${table.command}) = 'object'`,
    ),
  ],
);

export const paymentOperations = pgTable(
  'payment_operations',
  {
    key: text().primaryKey(),
    trancheId: text('tranche_id')
      .notNull()
      .references(() => paymentStreams.trancheId),
    operation: jsonb().$type<OperationIntent>().notNull(),
    providerRequestId: uuid('provider_request_id').notNull().unique(),
    status: text().$type<OperationStatus>().notNull(),
    reference: text(),
    reservedFromVersion: integer('reserved_from_version').notNull(),
    version: integer().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('payment_operation_tranche_key').on(table.trancheId, table.key),
    uniqueIndex('one_unresolved_payment').on(table.trancheId).where(sql`${table.status} IN ('RESERVED', 'AMBIGUOUS')`),
    check(
      'operation_identity_valid',
      sql`COALESCE(length(trim(${table.key})) > 0 AND jsonb_typeof(${table.operation}) = 'object' AND jsonb_typeof(${table.operation}->'key') = 'string' AND ${table.operation}->>'key' = ${table.key} AND jsonb_typeof(${table.operation}->'authorizationId') = 'string' AND length(trim(${table.operation}->>'authorizationId')) > 0 AND ${table.operation}->>'effect' IN ('CAPTURE', 'VOID', 'REAUTHORIZE'), false)`,
    ),
    check(
      'operation_effect_valid',
      sql`COALESCE((${table.operation}->>'effect' = 'CAPTURE' AND ${table.operation}->>'target' = 'RELEASED') OR (${table.operation}->>'effect' = 'VOID' AND ${table.operation}->>'target' IN ('RELEASED', 'REFUSED', 'EXPIRED', 'CANCELLED')) OR (${table.operation}->>'effect' = 'REAUTHORIZE' AND ${table.operation}->>'previousState' IN ('HELD', 'DECIDING', 'WAITING') AND jsonb_typeof(${table.operation}->'requestedAt') = 'number'), false)`,
    ),
    check('operation_status_valid', sql`${table.status} IN ('RESERVED', 'AMBIGUOUS', 'CONFIRMED', 'FAILED')`),
    check(
      'operation_version_valid',
      sql`${table.reservedFromVersion} >= 0 AND ${table.version} > ${table.reservedFromVersion}`,
    ),
    check(
      'resolved_operation_has_reference',
      sql`${table.status} NOT IN ('CONFIRMED', 'FAILED') OR length(trim(${table.reference})) > 0 AND ${table.reference} IS NOT NULL`,
    ),
  ],
);

export const paymentOperationEvents = pgTable(
  'payment_operation_events',
  {
    trancheId: text('tranche_id')
      .notNull()
      .references(() => paymentStreams.trancheId),
    key: text().notNull(),
    version: integer().notNull(),
    status: text().$type<OperationStatus>().notNull(),
    reference: text(),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    primaryKey({ columns: [table.trancheId, table.version] }),
    check('event_status_valid', sql`${table.status} IN ('RESERVED', 'AMBIGUOUS', 'CONFIRMED', 'FAILED')`),
    check('event_version_valid', sql`${table.version} > 0`),
    check(
      'resolved_event_has_reference',
      sql`${table.status} NOT IN ('CONFIRMED', 'FAILED') OR length(trim(${table.reference})) > 0 AND ${table.reference} IS NOT NULL`,
    ),
    foreignKey({
      columns: [table.trancheId, table.key],
      foreignColumns: [paymentOperations.trancheId, paymentOperations.key],
    }),
  ],
);
