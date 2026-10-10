CREATE TABLE "run_claims" (
	"kind" text NOT NULL,
	"job_id" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"claimed_until" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_reason" text,
	CONSTRAINT "run_claims_kind_job_id_pk" PRIMARY KEY("kind","job_id"),
	CONSTRAINT "run_claim_kind" CHECK ("run_claims"."kind" IN ('baseline', 'package') AND "run_claims"."attempts" >= 0)
);
