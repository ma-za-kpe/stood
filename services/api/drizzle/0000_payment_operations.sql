CREATE TABLE "payment_operation_events" (
	"tranche_id" text NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"reference" text,
	CONSTRAINT "payment_operation_events_tranche_id_version_pk" PRIMARY KEY("tranche_id","version")
);
--> statement-breakpoint
CREATE TABLE "payment_operations" (
	"key" text PRIMARY KEY NOT NULL,
	"tranche_id" text NOT NULL,
	"operation" jsonb NOT NULL,
	"provider_request_id" uuid NOT NULL,
	"status" text NOT NULL,
	"reference" text,
	"reserved_from_version" integer NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "payment_operations_provider_request_id_unique" UNIQUE("provider_request_id"),
	CONSTRAINT "operation_identity_valid" CHECK (COALESCE(length(trim("payment_operations"."key")) > 0 AND jsonb_typeof("payment_operations"."operation") = 'object' AND "payment_operations"."operation"->>'key' = "payment_operations"."key" AND length(trim("payment_operations"."operation"->>'authorizationId')) > 0 AND "payment_operations"."operation"->>'effect' IN ('CAPTURE', 'VOID', 'REAUTHORIZE'), false)),
	CONSTRAINT "operation_effect_valid" CHECK (COALESCE(("payment_operations"."operation"->>'effect' = 'CAPTURE' AND "payment_operations"."operation"->>'target' = 'RELEASED') OR ("payment_operations"."operation"->>'effect' = 'VOID' AND "payment_operations"."operation"->>'target' IN ('RELEASED', 'REFUSED', 'EXPIRED')) OR ("payment_operations"."operation"->>'effect' = 'REAUTHORIZE' AND "payment_operations"."operation"->>'previousState' IN ('HELD', 'DECIDING', 'WAITING') AND jsonb_typeof("payment_operations"."operation"->'requestedAt') = 'number'), false)),
	CONSTRAINT "operation_status_valid" CHECK ("payment_operations"."status" IN ('RESERVED', 'AMBIGUOUS', 'CONFIRMED', 'FAILED')),
	CONSTRAINT "operation_version_valid" CHECK ("payment_operations"."reserved_from_version" >= 0 AND "payment_operations"."version" > "payment_operations"."reserved_from_version"),
	CONSTRAINT "resolved_operation_has_reference" CHECK ("payment_operations"."status" NOT IN ('CONFIRMED', 'FAILED') OR length(trim("payment_operations"."reference")) > 0 AND "payment_operations"."reference" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "payment_streams" (
	"tranche_id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "stream_version_valid" CHECK ("payment_streams"."version" >= 0),
	CONSTRAINT "stream_id_valid" CHECK (length(trim("payment_streams"."tranche_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "payment_operation_events" ADD CONSTRAINT "payment_operation_events_tranche_id_payment_streams_tranche_id_fk" FOREIGN KEY ("tranche_id") REFERENCES "public"."payment_streams"("tranche_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_operation_events" ADD CONSTRAINT "payment_operation_events_key_payment_operations_key_fk" FOREIGN KEY ("key") REFERENCES "public"."payment_operations"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_tranche_id_payment_streams_tranche_id_fk" FOREIGN KEY ("tranche_id") REFERENCES "public"."payment_streams"("tranche_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_unresolved_payment" ON "payment_operations" USING btree ("tranche_id") WHERE "payment_operations"."status" IN ('RESERVED', 'AMBIGUOUS');
