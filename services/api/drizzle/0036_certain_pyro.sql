CREATE TABLE "upload_cleanup_retries" (
	"session_id" text NOT NULL,
	"object_key" text NOT NULL,
	"attempts" integer NOT NULL,
	"next_attempt_at" bigint NOT NULL,
	CONSTRAINT "upload_cleanup_retries_session_id_object_key_pk" PRIMARY KEY("session_id","object_key"),
	CONSTRAINT "upload_cleanup_retry_key_valid" CHECK ("upload_cleanup_retries"."object_key" ~ ('^uploads/' || "upload_cleanup_retries"."session_id" || '/[0-9]+-[a-f0-9]{64}$')),
	CONSTRAINT "upload_cleanup_retry_attempts_valid" CHECK ("upload_cleanup_retries"."attempts" > 0),
	CONSTRAINT "upload_cleanup_retry_time_valid" CHECK ("upload_cleanup_retries"."next_attempt_at" >= 0)
);
--> statement-breakpoint
ALTER TABLE "upload_cleanup_retries" ADD CONSTRAINT "upload_cleanup_retries_session_id_upload_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_cleanup_retry_due" ON "upload_cleanup_retries" USING btree ("next_attempt_at","session_id");
