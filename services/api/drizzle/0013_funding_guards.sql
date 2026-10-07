CREATE FUNCTION protect_funding_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM payment_streams WHERE tranche_id = NEW.tranche_id FOR UPDATE;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RESERVED' OR NEW.version <> 0 OR NEW.order_id IS NOT NULL
       OR NEW.approval_url IS NOT NULL OR NEW.hold IS NOT NULL OR NEW.reference IS NOT NULL THEN
      RAISE EXCEPTION 'Funding must start with a reservation';
    END IF;
    IF EXISTS (SELECT 1 FROM payment_operations WHERE tranche_id = NEW.tranche_id AND status IN ('RESERVED', 'AMBIGUOUS')) THEN
      RAISE EXCEPTION 'Funding conflicts with unresolved settlement';
    END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF ROW(NEW.key, NEW.tranche_id, NEW.instruction, NEW.create_request_id, NEW.authorize_request_id, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.key, OLD.tranche_id, OLD.instruction, OLD.create_request_id, OLD.authorize_request_id, OLD.created_at) THEN
    RAISE EXCEPTION 'Funding identity is immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 OR OLD.status IN ('HELD', 'FAILED', 'EXPIRED') THEN
    RAISE EXCEPTION 'Funding version must advance and resolution is immutable';
  END IF;
  IF NOT ((OLD.status = 'RESERVED' AND NEW.status = 'CREATING') OR
          (OLD.status = 'CREATING' AND NEW.status = 'AWAITING_APPROVAL') OR
          (OLD.status = 'AWAITING_APPROVAL' AND NEW.status = 'AUTHORIZING') OR
          (OLD.status = 'AUTHORIZING' AND NEW.status IN ('HELD', 'FAILED', 'EXPIRED'))) THEN
    RAISE EXCEPTION 'Invalid funding transition';
  END IF;
  IF OLD.status <> 'CREATING' AND ROW(NEW.order_id, NEW.approval_url) IS DISTINCT FROM ROW(OLD.order_id, OLD.approval_url) THEN
    RAISE EXCEPTION 'Funding order identity is immutable';
  END IF;
  IF NEW.status NOT IN ('HELD', 'FAILED', 'EXPIRED') AND NEW.reference IS NOT NULL THEN
    RAISE EXCEPTION 'Unresolved funding has no resolution reference';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER funding_operation_guard BEFORE INSERT OR UPDATE ON funding_operations
FOR EACH ROW EXECUTE FUNCTION protect_funding_operation();
--> statement-breakpoint
CREATE TRIGGER funding_operations_retained BEFORE DELETE OR TRUNCATE ON funding_operations
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_history_mutation();
--> statement-breakpoint
CREATE FUNCTION protect_funding_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_row funding_operations; previous_version integer;
BEGIN
  SELECT * INTO current_row FROM funding_operations WHERE key = NEW.key FOR UPDATE;
  IF ROW(NEW.version, NEW.status, NEW.reference) IS DISTINCT FROM ROW(current_row.version, current_row.status, current_row.reference) THEN
    RAISE EXCEPTION 'Funding event must match its operation';
  END IF;
  SELECT max(version) INTO previous_version FROM funding_events WHERE key = NEW.key;
  IF (previous_version IS NULL AND (NEW.version <> 0 OR NEW.status <> 'RESERVED' OR NEW.reference IS NOT NULL)) OR
     (previous_version IS NOT NULL AND NEW.version <> previous_version + 1) THEN
    RAISE EXCEPTION 'Funding history must start reserved and advance consecutively';
  END IF;
  NEW.recorded_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER funding_event_guard BEFORE INSERT ON funding_events
FOR EACH ROW EXECUTE FUNCTION protect_funding_event();
--> statement-breakpoint
CREATE TRIGGER funding_events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON funding_events
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_history_mutation();
--> statement-breakpoint
CREATE FUNCTION require_funding_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM funding_events WHERE key = NEW.key AND version = NEW.version
      AND status = NEW.status AND reference IS NOT DISTINCT FROM NEW.reference) THEN
    RAISE EXCEPTION 'Funding requires an atomic audit event';
  END IF;
  IF NEW.status IN ('HELD', 'FAILED', 'EXPIRED') AND NOT EXISTS (
    SELECT 1 FROM tranche_commands c JOIN payment_streams s ON s.tranche_id = c.tranche_id
    WHERE c.tranche_id = NEW.tranche_id AND c.version = (NEW.instruction->>'expectedVersion')::integer + 1
      AND c.command_id = 'funding:' || NEW.key || CASE WHEN NEW.status = 'HELD' THEN ':held' WHEN NEW.status = 'EXPIRED' THEN ':expired' ELSE ':failed' END
      AND c.command->>'method' = 'confirmFunding'
      AND c.command->'args'->0->>'kind' = CASE WHEN NEW.status = 'HELD' THEN 'HELD' WHEN NEW.status = 'EXPIRED' THEN 'EXPIRED' ELSE 'FAILED' END
      AND c.command->'args'->0->>'reference' = NEW.reference
      AND (NEW.status = 'FAILED' OR c.command->'args'->0 = (NEW.hold - 'orderId') || jsonb_build_object('kind', NEW.status, 'nonce', NEW.instruction->>'nonce'))
  ) THEN RAISE EXCEPTION 'Funding resolution requires an atomic tranche transition'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER funding_history_coupled AFTER INSERT OR UPDATE ON funding_operations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_funding_history();
--> statement-breakpoint
CREATE FUNCTION exclude_funding_settlement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM payment_streams WHERE tranche_id = NEW.tranche_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM funding_operations WHERE tranche_id = NEW.tranche_id AND status NOT IN ('HELD', 'FAILED', 'EXPIRED')) THEN
    RAISE EXCEPTION 'Settlement conflicts with unresolved funding';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_excludes_funding BEFORE INSERT ON payment_operations
FOR EACH ROW EXECUTE FUNCTION exclude_funding_settlement();
--> statement-breakpoint
CREATE FUNCTION require_funding_stream_resolution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM funding_operations WHERE tranche_id = NEW.tranche_id AND status NOT IN ('HELD', 'FAILED', 'EXPIRED')) THEN
    RAISE EXCEPTION 'Tranche transition cannot leave unresolved funding';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tranche_funding_coupled AFTER UPDATE ON payment_streams
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_funding_stream_resolution();
