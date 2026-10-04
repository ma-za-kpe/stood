CREATE FUNCTION reject_payment_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payment history is append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_history_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON payment_operation_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_history_mutation();
--> statement-breakpoint
CREATE FUNCTION protect_payment_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.tranche_id IS DISTINCT FROM OLD.tranche_id
     OR NEW.operation IS DISTINCT FROM OLD.operation
     OR NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id
     OR NEW.reserved_from_version IS DISTINCT FROM OLD.reserved_from_version THEN
    RAISE EXCEPTION 'Operation identity is immutable';
  END IF;
  IF OLD.status IN ('CONFIRMED', 'FAILED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Operation already resolved';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_identity_immutable BEFORE UPDATE ON payment_operations
FOR EACH ROW EXECUTE FUNCTION protect_payment_identity();
