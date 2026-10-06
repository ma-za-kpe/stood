CREATE TABLE "mandate_events" (
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "mandate_events_key_version_pk" PRIMARY KEY("key","version"),
	CONSTRAINT "mandate_event_valid" CHECK ("mandate_events"."version" >= 0 AND "mandate_events"."status" IN ('RESERVED', 'CREATING', 'AWAITING_APPROVAL', 'TOKENIZING', 'SIGNED', 'REVOKED') AND COALESCE("mandate_events"."snapshot"->>'key' = "mandate_events"."key" AND ("mandate_events"."snapshot"->>'version')::integer = "mandate_events"."version" AND "mandate_events"."snapshot"->>'status' = "mandate_events"."status", false))
);
--> statement-breakpoint
CREATE TABLE "mandate_signatures" (
	"key" text PRIMARY KEY NOT NULL,
	"allowance_id" text NOT NULL,
	"platform_id" text NOT NULL,
	"terms_version" integer NOT NULL,
	"terms_hash" text NOT NULL,
	"customer_ref" text NOT NULL,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"setup_request_id" uuid NOT NULL,
	"token_request_id" uuid NOT NULL,
	"setup_id" text,
	"customer_id" text,
	"payer_id" text,
	"token_id" text,
	"approval_url" text,
	"accepted_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "mandate_signatures_customer_ref_unique" UNIQUE("customer_ref"),
	CONSTRAINT "mandate_signatures_setup_request_id_unique" UNIQUE("setup_request_id"),
	CONSTRAINT "mandate_signatures_token_request_id_unique" UNIQUE("token_request_id"),
	CONSTRAINT "mandate_signatures_setup_id_unique" UNIQUE("setup_id"),
	CONSTRAINT "mandate_signatures_token_id_unique" UNIQUE("token_id"),
	CONSTRAINT "mandate_identity_valid" CHECK (length(trim("mandate_signatures"."key")) BETWEEN 1 AND 200 AND "mandate_signatures"."terms_version" = 1 AND "mandate_signatures"."terms_hash" ~ '^[a-f0-9]{64}$' AND "mandate_signatures"."customer_ref" ~ '^[a-f0-9]{64}$' AND "mandate_signatures"."setup_request_id" <> "mandate_signatures"."token_request_id" AND "mandate_signatures"."mode" IN ('sim', 'live')),
	CONSTRAINT "mandate_time_valid" CHECK ("mandate_signatures"."accepted_at" >= 0 AND "mandate_signatures"."expires_at" > "mandate_signatures"."accepted_at" AND "mandate_signatures"."expires_at" <= 9007199254740991),
	CONSTRAINT "mandate_phase_valid" CHECK ("mandate_signatures"."version" >= 0 AND (
    ("mandate_signatures"."status" IN ('RESERVED', 'CREATING') AND "mandate_signatures"."setup_id" IS NULL AND "mandate_signatures"."customer_id" IS NULL AND "mandate_signatures"."payer_id" IS NULL AND "mandate_signatures"."token_id" IS NULL AND "mandate_signatures"."approval_url" IS NULL) OR
    ("mandate_signatures"."status" = 'AWAITING_APPROVAL' AND length(trim("mandate_signatures"."setup_id")) > 0 AND length(trim("mandate_signatures"."customer_id")) > 0 AND ("mandate_signatures"."approval_url" IS NULL OR length(trim("mandate_signatures"."approval_url")) > 0) AND "mandate_signatures"."payer_id" IS NULL AND "mandate_signatures"."token_id" IS NULL) OR
    ("mandate_signatures"."status" = 'TOKENIZING' AND length(trim("mandate_signatures"."setup_id")) > 0 AND length(trim("mandate_signatures"."customer_id")) > 0 AND ("mandate_signatures"."approval_url" IS NULL OR length(trim("mandate_signatures"."approval_url")) > 0) AND length(trim("mandate_signatures"."payer_id")) > 0 AND "mandate_signatures"."token_id" IS NULL) OR
    ("mandate_signatures"."status" IN ('SIGNED', 'REVOKED') AND length(trim("mandate_signatures"."setup_id")) > 0 AND length(trim("mandate_signatures"."customer_id")) > 0 AND ("mandate_signatures"."approval_url" IS NULL OR length(trim("mandate_signatures"."approval_url")) > 0) AND length(trim("mandate_signatures"."payer_id")) > 0 AND length(trim("mandate_signatures"."token_id")) > 0)) IS TRUE)
);
--> statement-breakpoint
ALTER TABLE "mandate_events" ADD CONSTRAINT "mandate_events_key_mandate_signatures_key_fk" FOREIGN KEY ("key") REFERENCES "public"."mandate_signatures"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_signatures" ADD CONSTRAINT "mandate_signatures_allowance_id_api_allowances_id_fk" FOREIGN KEY ("allowance_id") REFERENCES "public"."api_allowances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandate_signatures" ADD CONSTRAINT "mandate_signatures_allowance_id_platform_id_api_allowances_id_platform_id_fk" FOREIGN KEY ("allowance_id","platform_id") REFERENCES "public"."api_allowances"("id","platform_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_mandate" ON "mandate_signatures" USING btree ("allowance_id") WHERE "mandate_signatures"."status" <> 'REVOKED';
