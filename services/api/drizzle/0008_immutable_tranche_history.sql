CREATE TRIGGER tranche_history_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON tranche_commands
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_history_mutation();
--> statement-breakpoint
CREATE FUNCTION protect_tranche_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_commands jsonb; new_commands jsonb; prefix jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.record IS NOT NULL AND (NEW.version <> 0 OR NEW.initial_record::jsonb IS DISTINCT FROM NEW.record::jsonb
       OR (NEW.record::jsonb)->'definition'->>'id' IS DISTINCT FROM NEW.tranche_id) THEN
      RAISE EXCEPTION 'Invalid initial tranche record';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.tranche_id IS DISTINCT FROM OLD.tranche_id OR NEW.initial_record IS DISTINCT FROM OLD.initial_record THEN
    RAISE EXCEPTION 'Tranche identity is immutable';
  END IF;
  IF NEW.version <= OLD.version THEN RAISE EXCEPTION 'Tranche version must increase'; END IF;
  IF OLD.record IS NULL THEN
    IF NEW.record IS NOT NULL THEN RAISE EXCEPTION 'Cannot upgrade ledger-only stream'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.record IS NULL OR NEW.version <> OLD.version + 1 OR
     (NEW.record::jsonb - 'commands') IS DISTINCT FROM (OLD.record::jsonb - 'commands') THEN
    RAISE EXCEPTION 'Tranche definition and rule header are immutable';
  END IF;
  old_commands := OLD.record::jsonb->'commands'; new_commands := NEW.record::jsonb->'commands';
  SELECT COALESCE(jsonb_agg(value ORDER BY ordinal), '[]'::jsonb) INTO prefix
    FROM jsonb_array_elements(new_commands) WITH ORDINALITY AS items(value, ordinal)
    WHERE ordinal <= jsonb_array_length(old_commands);
  IF jsonb_array_length(new_commands) <> jsonb_array_length(old_commands) + 1 OR prefix IS DISTINCT FROM old_commands THEN
    RAISE EXCEPTION 'Tranche transitions are append-only';
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER tranche_record_protected BEFORE INSERT OR UPDATE ON payment_streams
FOR EACH ROW EXECUTE FUNCTION protect_tranche_record();
--> statement-breakpoint
CREATE TRIGGER tranche_streams_retained BEFORE DELETE OR TRUNCATE ON payment_streams
FOR EACH STATEMENT EXECUTE FUNCTION reject_payment_history_mutation();
--> statement-breakpoint
CREATE FUNCTION require_tranche_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.record IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tranche_commands WHERE tranche_id = NEW.tranche_id AND version = NEW.version AND record = NEW.record
  ) THEN RAISE EXCEPTION 'Tranche state requires atomic journal'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER tranche_journal_coupled AFTER UPDATE ON payment_streams
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_tranche_journal();
--> statement-breakpoint
CREATE FUNCTION require_aggregate_payment_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM payment_streams WHERE tranche_id = NEW.tranche_id AND record IS NOT NULL) THEN
    IF NOT EXISTS (SELECT 1 FROM tranche_commands WHERE tranche_id = NEW.tranche_id AND version = NEW.version)
       OR NOT EXISTS (SELECT 1 FROM payment_operation_events WHERE tranche_id = NEW.tranche_id AND key = NEW.key
                      AND version = NEW.version AND status = NEW.status AND reference IS NOT DISTINCT FROM NEW.reference) THEN
      RAISE EXCEPTION 'Aggregate operation requires atomic journal and event';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER aggregate_payment_coupled AFTER INSERT OR UPDATE ON payment_operations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_aggregate_payment_event();
