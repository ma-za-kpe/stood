CREATE TABLE "allowance_versions" (
	"allowance_id" text NOT NULL,
	"platform_id" text NOT NULL,
	"terms_version" integer NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"body" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "allowance_versions_allowance_id_terms_version_pk" PRIMARY KEY("allowance_id","terms_version"),
	CONSTRAINT "allowance_version_receipt" UNIQUE("platform_id","allowance_id","key"),
	CONSTRAINT "allowance_version_valid" CHECK ("allowance_versions"."terms_version" > 1 AND length(trim("allowance_versions"."key")) BETWEEN 1 AND 200
      AND "allowance_versions"."fingerprint" ~ '^[a-f0-9]{64}$'
      AND COALESCE("allowance_versions"."body"->>'id' = "allowance_versions"."allowance_id" AND "allowance_versions"."body"->>'status' = 'DRAFT', false))
);
--> statement-breakpoint
ALTER TABLE "allowance_versions" ADD CONSTRAINT "allowance_versions_allowance_id_platform_id_api_allowances_id_platform_id_fk" FOREIGN KEY ("allowance_id","platform_id") REFERENCES "public"."api_allowances"("id","platform_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE TRIGGER allowance_versions_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON allowance_versions
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_history_mutation();
