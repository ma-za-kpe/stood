CREATE TABLE "funding_events" (
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"reference" text,
	"recorded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "funding_events_key_version_pk" PRIMARY KEY("key","version"),
	CONSTRAINT "funding_event_version_valid" CHECK ("funding_events"."version" >= 0),
	CONSTRAINT "funding_event_status_valid" CHECK ("funding_events"."status" IN ('RESERVED', 'CREATING', 'AWAITING_APPROVAL', 'AUTHORIZING', 'HELD', 'FAILED', 'EXPIRED')),
	CONSTRAINT "funding_event_resolution_valid" CHECK ("funding_events"."status" NOT IN ('HELD', 'FAILED', 'EXPIRED') OR ("funding_events"."reference" IS NOT NULL AND length(trim("funding_events"."reference")) > 0))
);
--> statement-breakpoint
CREATE TABLE "funding_operations" (
	"key" text PRIMARY KEY NOT NULL,
	"tranche_id" text NOT NULL,
	"instruction" jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"create_request_id" uuid NOT NULL,
	"authorize_request_id" uuid NOT NULL,
	"order_id" text,
	"approval_url" text,
	"hold" jsonb,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "funding_operations_create_request_id_unique" UNIQUE("create_request_id"),
	CONSTRAINT "funding_operations_authorize_request_id_unique" UNIQUE("authorize_request_id"),
	CONSTRAINT "funding_operations_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "funding_tranche_key" UNIQUE("tranche_id","key"),
	CONSTRAINT "funding_status_valid" CHECK ("funding_operations"."status" IN ('RESERVED', 'CREATING', 'AWAITING_APPROVAL', 'AUTHORIZING', 'HELD', 'FAILED', 'EXPIRED')),
	CONSTRAINT "funding_version_valid" CHECK ("funding_operations"."version" >= 0),
	CONSTRAINT "funding_request_ids_distinct" CHECK ("funding_operations"."create_request_id" <> "funding_operations"."authorize_request_id"),
	CONSTRAINT "funding_identity_valid" CHECK (COALESCE(length(trim("funding_operations"."key")) BETWEEN 1 AND 200 AND "funding_operations"."instruction"->>'key' = "funding_operations"."key" AND "funding_operations"."instruction"->>'trancheId' = "funding_operations"."tranche_id" AND "funding_operations"."instruction"->>'mode' IN ('sim', 'live'), false)),
	CONSTRAINT "funding_order_required" CHECK ("funding_operations"."status" NOT IN ('AWAITING_APPROVAL', 'AUTHORIZING', 'HELD', 'EXPIRED') OR ("funding_operations"."order_id" IS NOT NULL AND length(trim("funding_operations"."order_id")) > 0 AND "funding_operations"."approval_url" IS NOT NULL)),
	CONSTRAINT "funding_resolution_valid" CHECK (("funding_operations"."status" NOT IN ('HELD', 'EXPIRED') OR COALESCE(jsonb_typeof("funding_operations"."hold") = 'object' AND "funding_operations"."hold"->>'orderId' = "funding_operations"."order_id" AND "funding_operations"."hold"->>'reference' = "funding_operations"."reference", false)) AND ("funding_operations"."status" NOT IN ('HELD', 'FAILED', 'EXPIRED') OR ("funding_operations"."reference" IS NOT NULL AND length(trim("funding_operations"."reference")) > 0)) AND ("funding_operations"."status" IN ('HELD', 'EXPIRED') OR "funding_operations"."hold" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "funding_events" ADD CONSTRAINT "funding_events_key_funding_operations_key_fk" FOREIGN KEY ("key") REFERENCES "public"."funding_operations"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_operations" ADD CONSTRAINT "funding_operations_tranche_id_payment_streams_tranche_id_fk" FOREIGN KEY ("tranche_id") REFERENCES "public"."payment_streams"("tranche_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_unresolved_funding" ON "funding_operations" USING btree ("tranche_id") WHERE "funding_operations"."status" NOT IN ('HELD', 'FAILED', 'EXPIRED');
