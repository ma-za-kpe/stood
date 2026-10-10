CREATE TABLE "usage_receipts" (
	"nonce" text PRIMARY KEY NOT NULL,
	"platform_id" text NOT NULL,
	"tranche_id" text NOT NULL,
	"commit" text NOT NULL,
	"receipt" jsonb NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "usage_receipt_valid" CHECK ("usage_receipts"."commit" ~ '^[a-f0-9]{40}$' AND jsonb_typeof("usage_receipts"."receipt") = 'object')
);
--> statement-breakpoint
CREATE INDEX "usage_receipt_tranche" ON "usage_receipts" USING btree ("tranche_id","commit");
