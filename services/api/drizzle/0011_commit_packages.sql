CREATE TABLE "commit_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_id" text NOT NULL,
	"tranche_id" text NOT NULL,
	"key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"waiting_for" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "commit_package_request" UNIQUE("platform_id","tranche_id","key"),
	CONSTRAINT "commit_package_valid" CHECK (length(trim("commit_packages"."key")) BETWEEN 1 AND 200 AND "commit_packages"."fingerprint" ~ '^[a-f0-9]{64}$' AND jsonb_typeof("commit_packages"."metadata") = 'object' AND "commit_packages"."waiting_for" IN ('HOLD','RENEWAL','RUNNER'))
);
--> statement-breakpoint
ALTER TABLE "api_tranche_owners" ADD CONSTRAINT "owner_platform_identity" UNIQUE("tranche_id","platform_id");
--> statement-breakpoint
ALTER TABLE "commit_packages" ADD CONSTRAINT "commit_packages_tranche_id_platform_id_api_tranche_owners_tranche_id_platform_id_fk" FOREIGN KEY ("tranche_id","platform_id") REFERENCES "public"."api_tranche_owners"("tranche_id","platform_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION guard_commit_package() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Commit package intake is immutable';
  END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER commit_package_guard BEFORE INSERT OR UPDATE OR DELETE ON commit_packages
  FOR EACH ROW EXECUTE FUNCTION guard_commit_package();
--> statement-breakpoint
CREATE TRIGGER commit_package_truncate BEFORE TRUNCATE ON commit_packages
  FOR EACH STATEMENT EXECUTE FUNCTION guard_commit_package();
