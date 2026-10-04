CREATE FUNCTION require_payment_reservation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'RESERVED' OR NEW.reference IS NOT NULL THEN
    RAISE EXCEPTION 'New operation must be reserved without reference';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_reservation_first BEFORE INSERT ON payment_operations
FOR EACH ROW EXECUTE FUNCTION require_payment_reservation();
--> statement-breakpoint
CREATE FUNCTION require_first_payment_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM payment_operations WHERE key = NEW.key FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM payment_operation_events WHERE key = NEW.key)
     AND (NEW.status IS DISTINCT FROM 'RESERVED' OR NEW.reference IS NOT NULL) THEN
    RAISE EXCEPTION 'First event must be reserved without reference';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_event_reservation_first BEFORE INSERT ON payment_operation_events
FOR EACH ROW EXECUTE FUNCTION require_first_payment_event();
