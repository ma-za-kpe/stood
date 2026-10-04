CREATE OR REPLACE FUNCTION protect_payment_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.tranche_id IS DISTINCT FROM OLD.tranche_id
     OR NEW.operation IS DISTINCT FROM OLD.operation
     OR NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id
     OR NEW.reserved_from_version IS DISTINCT FROM OLD.reserved_from_version THEN
    RAISE EXCEPTION 'Operation identity is immutable';
  END IF;
  IF OLD.status IN ('CONFIRMED', 'FAILED') THEN
    RAISE EXCEPTION 'Operation already resolved';
  END IF;
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Operation timestamp is immutable';
  END IF;
  IF NEW.version <= OLD.version THEN
    RAISE EXCEPTION 'Operation version must increase';
  END IF;
  IF NEW.status NOT IN ('AMBIGUOUS', 'CONFIRMED', 'FAILED') THEN
    RAISE EXCEPTION 'Invalid operation transition';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION set_payment_operation_time() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_operation_server_time BEFORE INSERT ON payment_operations
FOR EACH ROW EXECUTE FUNCTION set_payment_operation_time();
--> statement-breakpoint
CREATE FUNCTION set_payment_event_time() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_event_server_time BEFORE INSERT ON payment_operation_events
FOR EACH ROW EXECUTE FUNCTION set_payment_event_time();
