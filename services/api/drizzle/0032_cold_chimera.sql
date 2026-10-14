CREATE TABLE "upload_cleanup_receipts" (
	"session_id" text NOT NULL,
	"object_key" text NOT NULL,
	"outcome" text NOT NULL,
	"recorded_at" bigint NOT NULL,
	CONSTRAINT "upload_cleanup_receipts_session_id_object_key_pk" PRIMARY KEY("session_id","object_key"),
	CONSTRAINT "upload_cleanup_key_valid" CHECK ("upload_cleanup_receipts"."object_key" ~ ('^uploads/' || "upload_cleanup_receipts"."session_id" || '/[0-9]+-[a-f0-9]{64}$')),
	CONSTRAINT "upload_cleanup_outcome_valid" CHECK ("upload_cleanup_receipts"."outcome" IN ('DELETED', 'ABSENT')),
	CONSTRAINT "upload_cleanup_time_valid" CHECK ("upload_cleanup_receipts"."recorded_at" >= 0)
);
--> statement-breakpoint
ALTER TABLE "upload_cleanup_receipts" ADD CONSTRAINT "upload_cleanup_receipts_session_id_upload_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION protect_upload_cleanup_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'upload cleanup receipts are immutable' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER upload_cleanup_receipt_immutable BEFORE UPDATE OR DELETE ON upload_cleanup_receipts
FOR EACH ROW EXECUTE FUNCTION protect_upload_cleanup_receipt();
