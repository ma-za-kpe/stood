CREATE TABLE "payment_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"tranche_id" text NOT NULL,
	"operation_key" text,
	"code" text NOT NULL,
	"owner" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "alert_owner_valid" CHECK (length(trim("payment_alerts"."owner")) > 0),
	CONSTRAINT "alert_status_valid" CHECK ("payment_alerts"."status" IN ('OPEN', 'RESOLVED')),
	CONSTRAINT "alert_code_valid" CHECK ("payment_alerts"."code" IN ('PROVIDER_UNKNOWN', 'UNRESOLVED_3H', 'SAFE_CANCEL_REQUESTED', 'WORKER_FAILURE'))
);
--> statement-breakpoint
CREATE TABLE "reconciliation_jobs" (
	"tranche_id" text PRIMARY KEY NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"lease_token" uuid,
	"leased_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payment_alerts" ADD CONSTRAINT "payment_alerts_tranche_id_payment_streams_tranche_id_fk" FOREIGN KEY ("tranche_id") REFERENCES "public"."payment_streams"("tranche_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_jobs" ADD CONSTRAINT "reconciliation_jobs_tranche_id_payment_streams_tranche_id_fk" FOREIGN KEY ("tranche_id") REFERENCES "public"."payment_streams"("tranche_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION guard_payment_alert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.opened_at := clock_timestamp();
  ELSIF ROW(NEW.id, NEW.tranche_id, NEW.operation_key, NEW.code, NEW.opened_at)
      IS DISTINCT FROM ROW(OLD.id, OLD.tranche_id, OLD.operation_key, OLD.code, OLD.opened_at) THEN
    RAISE EXCEPTION 'Alert identity and opened time are immutable';
  END IF;
  NEW.last_seen_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_alert_clock BEFORE INSERT OR UPDATE ON payment_alerts
  FOR EACH ROW EXECUTE FUNCTION guard_payment_alert();
