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
import type { CommitPackageInput, StoredCommitPackage } from '../../ports/commit-package-store.js';
import type { FundingHold, FundingInstruction, FundingStatus } from '../../ports/funding-store.js';
import type { OperationIntent, OperationStatus } from '../../ports/payment-operation-store.js';
import type { StoredDraft } from '../../ports/platform-api-store.js';
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

export const apiAllowances = pgTable(
  'api_allowances',
  {
    id: text().primaryKey(),
    platformId: text('platform_id').notNull(),
    body: jsonb().$type<StoredDraft>().notNull(),
  },
  (table) => [
    unique('allowance_platform_identity').on(table.id, table.platformId),
    check(
      'allowance_draft_valid',
      sql`length(trim(${table.platformId})) > 0 AND COALESCE(${table.body}->>'id' = ${table.id} AND ${table.body}->>'status' = 'DRAFT', false)`,
    ),
  ],
);
export const apiTrancheOwners = pgTable(
  'api_tranche_owners',
  {
    trancheId: text('tranche_id')
      .primaryKey()
      .references(() => paymentStreams.trancheId),
    allowanceId: text('allowance_id').notNull(),
    platformId: text('platform_id').notNull(),
  },
  (table) => [
    unique('owner_platform_identity').on(table.trancheId, table.platformId),
    foreignKey({
      columns: [table.allowanceId, table.platformId],
      foreignColumns: [apiAllowances.id, apiAllowances.platformId],
    }),
  ],
);
export const commitPackages = pgTable(
  'commit_packages',
  {
    id: text().primaryKey(),
    platformId: text('platform_id').notNull(),
    trancheId: text('tranche_id').notNull(),
    key: text().notNull(),
    fingerprint: text().notNull(),
    metadata: jsonb().$type<CommitPackageInput>().notNull(),
    waitingFor: text('waiting_for').$type<StoredCommitPackage['waitingFor']>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('commit_package_request').on(table.platformId, table.trancheId, table.key),
    foreignKey({
      columns: [table.trancheId, table.platformId],
      foreignColumns: [apiTrancheOwners.trancheId, apiTrancheOwners.platformId],
    }),
    check(
      'commit_package_valid',
      sql`length(trim(${table.key})) BETWEEN 1 AND 200 AND ${table.fingerprint} ~ '^[a-f0-9]{64}$' AND jsonb_typeof(${table.metadata}) = 'object' AND ${table.waitingFor} IN ('HOLD','RENEWAL','RUNNER')`,
    ),
  ],
);
export const apiRequests = pgTable(
  'api_requests',
  {
    platformId: text('platform_id').notNull(),
    key: text().notNull(),
    fingerprint: text().notNull(),
    response: jsonb().$type<StoredDraft>().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.platformId, table.key] }),
    check(
      'api_request_valid',
      sql`length(trim(${table.platformId})) > 0 AND length(trim(${table.key})) BETWEEN 1 AND 200 AND ${table.fingerprint} ~ '^[a-f0-9]{64}$' AND jsonb_typeof(${table.response}) = 'object'`,
    ),
  ],
);

export const fundingOperations = pgTable(
  'funding_operations',
  {
    key: text().primaryKey(),
    trancheId: text('tranche_id')
      .notNull()
      .references(() => paymentStreams.trancheId),
    instruction: jsonb().$type<FundingInstruction>().notNull(),
    version: integer().notNull().default(0),
    status: text().$type<FundingStatus>().notNull(),
    createRequestId: uuid('create_request_id').notNull().unique(),
    authorizeRequestId: uuid('authorize_request_id').notNull().unique(),
    orderId: text('order_id').unique(),
    approvalUrl: text('approval_url'),
    hold: jsonb().$type<FundingHold & Readonly<{ now?: number }>>(),
    reference: text(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique('funding_tranche_key').on(t.trancheId, t.key),
    uniqueIndex('one_unresolved_funding').on(t.trancheId).where(sql`${t.status} NOT IN ('HELD', 'FAILED', 'EXPIRED')`),
    check(
      'funding_status_valid',
      sql`${t.status} IN ('RESERVED', 'CREATING', 'AWAITING_APPROVAL', 'AUTHORIZING', 'HELD', 'FAILED', 'EXPIRED')`,
    ),
    check('funding_version_valid', sql`${t.version} >= 0`),
    check('funding_request_ids_distinct', sql`${t.createRequestId} <> ${t.authorizeRequestId}`),
    check(
      'funding_identity_valid',
      sql`COALESCE(length(trim(${t.key})) BETWEEN 1 AND 200 AND ${t.instruction}->>'key' = ${t.key} AND ${t.instruction}->>'trancheId' = ${t.trancheId} AND ${t.instruction}->>'mode' IN ('sim', 'live'), false)`,
    ),
    check(
      'funding_order_required',
      sql`${t.status} NOT IN ('AWAITING_APPROVAL', 'AUTHORIZING', 'HELD', 'EXPIRED') OR (${t.orderId} IS NOT NULL AND length(trim(${t.orderId})) > 0 AND ${t.approvalUrl} IS NOT NULL)`,
    ),
    check(
      'funding_resolution_valid',
      sql`(${t.status} NOT IN ('HELD', 'EXPIRED') OR COALESCE(jsonb_typeof(${t.hold}) = 'object' AND ${t.hold}->>'orderId' = ${t.orderId} AND ${t.hold}->>'reference' = ${t.reference}, false)) AND (${t.status} NOT IN ('HELD', 'FAILED', 'EXPIRED') OR (${t.reference} IS NOT NULL AND length(trim(${t.reference})) > 0)) AND (${t.status} IN ('HELD', 'EXPIRED') OR ${t.hold} IS NULL)`,
    ),
  ],
);
export const fundingEvents = pgTable(
  'funding_events',
  {
    key: text()
      .notNull()
      .references(() => fundingOperations.key),
    version: integer().notNull(),
    status: text().$type<FundingStatus>().notNull(),
    reference: text(),
    recordedAt: timestamp('recorded_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.version] }),
    check('funding_event_version_valid', sql`${t.version} >= 0`),
    check(
      'funding_event_status_valid',
      sql`${t.status} IN ('RESERVED', 'CREATING', 'AWAITING_APPROVAL', 'AUTHORIZING', 'HELD', 'FAILED', 'EXPIRED')`,
    ),
    check(
      'funding_event_resolution_valid',
      sql`${t.status} NOT IN ('HELD', 'FAILED', 'EXPIRED') OR (${t.reference} IS NOT NULL AND length(trim(${t.reference})) > 0)`,
    ),
  ],
);
