CREATE TABLE "rate_windows" (
	"scope" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_windows_scope_window_start_pk" PRIMARY KEY("scope","window_start"),
	CONSTRAINT "rate_window_count" CHECK ("rate_windows"."count" >= 0 AND length("rate_windows"."scope") <= 200)
);
