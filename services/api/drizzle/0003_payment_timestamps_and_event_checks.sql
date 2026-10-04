ALTER TABLE "payment_operation_events" ADD COLUMN "recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_operations" ADD COLUMN "created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_operation_events" ADD CONSTRAINT "event_status_valid" CHECK ("payment_operation_events"."status" IN ('RESERVED', 'AMBIGUOUS', 'CONFIRMED', 'FAILED'));--> statement-breakpoint
ALTER TABLE "payment_operation_events" ADD CONSTRAINT "event_version_valid" CHECK ("payment_operation_events"."version" > 0);--> statement-breakpoint
ALTER TABLE "payment_operation_events" ADD CONSTRAINT "resolved_event_has_reference" CHECK ("payment_operation_events"."status" NOT IN ('CONFIRMED', 'FAILED') OR length(trim("payment_operation_events"."reference")) > 0 AND "payment_operation_events"."reference" IS NOT NULL);
