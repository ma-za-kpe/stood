CREATE TABLE "reconciliation_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"tranche_id" text,
	"provider_id" text,
	"operation_key" text,
	"owner" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "finding_kind_valid" CHECK ("reconciliation_findings"."kind" IN ('CAPTURE_WITHOUT_RELEASE', 'RELEASE_WITHOUT_CAPTURE', 'AMOUNT_MISMATCH', 'DUPLICATE_CAPTURE')),
	CONSTRAINT "finding_owner_valid" CHECK (length(trim("reconciliation_findings"."owner")) > 0),
	CONSTRAINT "finding_status_valid" CHECK ("reconciliation_findings"."status" IN ('OPEN', 'RESOLVED')),
	CONSTRAINT "finding_subject_valid" CHECK ("reconciliation_findings"."provider_id" IS NOT NULL OR "reconciliation_findings"."operation_key" IS NOT NULL)
);
