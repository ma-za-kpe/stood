CREATE TABLE "upload_assessment_receipts" (
	"upload_id" text PRIMARY KEY NOT NULL,
	"receipt" jsonb NOT NULL,
	"receipt_hash" text NOT NULL,
	"recorded_at" bigint NOT NULL,
	CONSTRAINT "upload_assessment_hash_valid" CHECK ("upload_assessment_receipts"."receipt_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "upload_assessment_time_valid" CHECK ("upload_assessment_receipts"."recorded_at" >= 0)
);
--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "allowance_id" text;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "terms_version" integer;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD COLUMN "assessment_nonce" text;--> statement-breakpoint
ALTER TABLE "upload_assessment_receipts" ADD CONSTRAINT "upload_assessment_receipts_upload_id_upload_sessions_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_assessment_binding_valid" CHECK (("upload_sessions"."allowance_id" IS NULL AND "upload_sessions"."terms_version" IS NULL AND "upload_sessions"."assessment_nonce" IS NULL) OR ("upload_sessions"."allowance_id" IS NOT NULL AND length(trim("upload_sessions"."allowance_id")) BETWEEN 1 AND 200 AND "upload_sessions"."terms_version" > 0 AND "upload_sessions"."assessment_nonce" ~ '^[a-f0-9]{64}$'));
--> statement-breakpoint
CREATE TRIGGER upload_assessment_receipts_retained BEFORE UPDATE OR DELETE OR TRUNCATE ON upload_assessment_receipts
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_history_mutation();
