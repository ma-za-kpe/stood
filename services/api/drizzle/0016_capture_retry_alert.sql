-- Forward-only: a consumed, still-unresolved capture retry is assigned to a person with a named alert.
ALTER TABLE "payment_alerts" DROP CONSTRAINT "alert_code_valid";--> statement-breakpoint
ALTER TABLE "payment_alerts" ADD CONSTRAINT "alert_code_valid" CHECK ("payment_alerts"."code" IN ('PROVIDER_UNKNOWN', 'UNRESOLVED_3H', 'SAFE_CANCEL_REQUESTED', 'WORKER_FAILURE', 'CAPTURE_RETRY_CONSUMED'));
