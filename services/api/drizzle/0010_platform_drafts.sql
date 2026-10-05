CREATE TABLE "api_allowances" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_id" text NOT NULL,
	"body" jsonb NOT NULL,
	CONSTRAINT "allowance_platform_identity" UNIQUE("id","platform_id"),
	CONSTRAINT "allowance_draft_valid" CHECK (length(trim("api_allowances"."platform_id")) > 0 AND COALESCE("api_allowances"."body"->>'id' = "api_allowances"."id" AND "api_allowances"."body"->>'status' = 'DRAFT', false))
);
--> statement-breakpoint
CREATE TABLE "api_requests" (
	"platform_id" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"response" jsonb NOT NULL,
	CONSTRAINT "api_requests_platform_id_key_pk" PRIMARY KEY("platform_id","key"),
	CONSTRAINT "api_request_valid" CHECK (length(trim("api_requests"."platform_id")) > 0 AND length(trim("api_requests"."key")) BETWEEN 1 AND 200 AND "api_requests"."fingerprint" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("api_requests"."response") = 'object')
);
--> statement-breakpoint
CREATE TABLE "api_tranche_owners" (
	"tranche_id" text PRIMARY KEY NOT NULL,
	"allowance_id" text NOT NULL,
	"platform_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_tranche_owners" ADD CONSTRAINT "api_tranche_owners_tranche_id_payment_streams_tranche_id_fk" FOREIGN KEY ("tranche_id") REFERENCES "public"."payment_streams"("tranche_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_tranche_owners" ADD CONSTRAINT "api_tranche_owners_allowance_id_platform_id_api_allowances_id_platform_id_fk" FOREIGN KEY ("allowance_id","platform_id") REFERENCES "public"."api_allowances"("id","platform_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER api_allowance_drafts_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON api_allowances
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_history_mutation();
--> statement-breakpoint
CREATE TRIGGER api_tenant_ownership_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON api_tranche_owners
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_history_mutation();
--> statement-breakpoint
CREATE TRIGGER api_idempotency_responses_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON api_requests
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_history_mutation();
