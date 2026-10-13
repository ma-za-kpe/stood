ALTER TABLE "mandate_signatures" DROP CONSTRAINT "mandate_identity_valid";--> statement-breakpoint
DROP INDEX "one_active_mandate";--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_mandate" ON "mandate_signatures" USING btree ("allowance_id","terms_version") WHERE "mandate_signatures"."status" <> 'REVOKED';--> statement-breakpoint
ALTER TABLE "mandate_signatures" ADD CONSTRAINT "mandate_identity_valid" CHECK (length(trim("mandate_signatures"."key")) BETWEEN 1 AND 200 AND "mandate_signatures"."terms_version" >= 1 AND "mandate_signatures"."terms_hash" ~ '^[a-f0-9]{64}$' AND "mandate_signatures"."customer_ref" ~ '^[a-f0-9]{64}$' AND "mandate_signatures"."setup_request_id" <> "mandate_signatures"."token_request_id" AND "mandate_signatures"."mode" IN ('sim', 'live'));
