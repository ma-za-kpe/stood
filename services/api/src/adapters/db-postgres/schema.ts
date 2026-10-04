import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { OperationIntent, OperationStatus } from '../../ports/payment-operation-store.js';

export const paymentStreams = pgTable(
  'payment_streams',
  {
    trancheId: text('tranche_id').primaryKey(),
    version: integer().notNull().default(0),
  },
  (table) => [
    check('stream_version_valid', sql`${table.version} >= 0`),
    check('stream_id_valid', sql`length(trim(${table.trancheId})) > 0`),
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
      sql`COALESCE((${table.operation}->>'effect' = 'CAPTURE' AND ${table.operation}->>'target' = 'RELEASED') OR (${table.operation}->>'effect' = 'VOID' AND ${table.operation}->>'target' IN ('RELEASED', 'REFUSED', 'EXPIRED')) OR (${table.operation}->>'effect' = 'REAUTHORIZE' AND ${table.operation}->>'previousState' IN ('HELD', 'DECIDING', 'WAITING') AND jsonb_typeof(${table.operation}->'requestedAt') = 'number'), false)`,
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
  },
  (table) => [
    primaryKey({ columns: [table.trancheId, table.version] }),
    foreignKey({
      columns: [table.trancheId, table.key],
      foreignColumns: [paymentOperations.trancheId, paymentOperations.key],
    }),
  ],
);
