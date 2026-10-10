CREATE TABLE "baselines" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_id" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"terms" jsonb NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "baseline_request" UNIQUE("platform_id","key"),
	CONSTRAINT "baseline_valid" CHECK (length(trim("baselines"."key")) BETWEEN 1 AND 200 AND "baselines"."fingerprint" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("baselines"."terms") = 'object' AND "baselines"."status" IN ('QUEUED','DONE','INVALID') AND (("baselines"."status" = 'DONE') = ("baselines"."result" IS NOT NULL)) AND (("baselines"."status" = 'QUEUED') = ("baselines"."finished_at" IS NULL)))
);
