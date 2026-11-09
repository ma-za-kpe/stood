ALTER TABLE "upload_assessment_receipts" ADD COLUMN "idempotency_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_assessment_receipts" ADD COLUMN "request_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_assessment_receipts" ADD CONSTRAINT "upload_assessment_idempotency_key_valid" CHECK (length(trim("upload_assessment_receipts"."idempotency_key")) BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "upload_assessment_receipts" ADD CONSTRAINT "upload_assessment_request_hash_valid" CHECK ("upload_assessment_receipts"."request_hash" ~ '^[a-f0-9]{64}$');
