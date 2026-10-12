CREATE TABLE "upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_id" text NOT NULL,
	"tranche_id" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"photos" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"completed_at" bigint,
	CONSTRAINT "upload_request_identity" UNIQUE("platform_id","tranche_id","key"),
	CONSTRAINT "upload_identity_valid" CHECK (length(trim("upload_sessions"."key")) BETWEEN 1 AND 200 AND "upload_sessions"."fingerprint" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "upload_photos_valid" CHECK (jsonb_typeof("upload_sessions"."photos") = 'array' AND jsonb_array_length("upload_sessions"."photos") BETWEEN 1 AND 10),
	CONSTRAINT "upload_time_valid" CHECK ("upload_sessions"."created_at" >= 0 AND "upload_sessions"."expires_at" = "upload_sessions"."created_at" + 900000),
	CONSTRAINT "upload_status_valid" CHECK (("upload_sessions"."status" = 'OPEN' AND "upload_sessions"."completed_at" IS NULL) OR ("upload_sessions"."status" = 'COMPLETE' AND "upload_sessions"."completed_at" >= "upload_sessions"."created_at" AND "upload_sessions"."completed_at" < "upload_sessions"."expires_at"))
);
--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_tranche_id_platform_id_api_tranche_owners_tranche_id_platform_id_fk" FOREIGN KEY ("tranche_id","platform_id") REFERENCES "public"."api_tranche_owners"("tranche_id","platform_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION protect_upload_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'upload receipts are immutable' USING ERRCODE = '23514'; END IF;
  IF (NEW.id, NEW.platform_id, NEW.tranche_id, NEW.key, NEW.fingerprint, NEW.photos, NEW.created_at, NEW.expires_at)
    IS DISTINCT FROM (OLD.id, OLD.platform_id, OLD.tranche_id, OLD.key, OLD.fingerprint, OLD.photos, OLD.created_at, OLD.expires_at)
    OR (OLD.status = 'COMPLETE' AND NEW IS DISTINCT FROM OLD)
  THEN RAISE EXCEPTION 'upload receipts are immutable' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER upload_session_immutable BEFORE UPDATE OR DELETE ON upload_sessions
FOR EACH ROW EXECUTE FUNCTION protect_upload_session();
