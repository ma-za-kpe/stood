CREATE FUNCTION guard_mandate_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN RAISE EXCEPTION 'mandate history is immutable'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RESERVED' OR NEW.version <> 0 THEN RAISE EXCEPTION 'reserve mandate before provider calls'; END IF;
    NEW.created_at := clock_timestamp();
    RETURN NEW;
  END IF;
  IF ROW(NEW.key, NEW.allowance_id, NEW.platform_id, NEW.terms_version, NEW.terms_hash,
    NEW.customer_ref, NEW.mode, NEW.setup_request_id, NEW.token_request_id, NEW.accepted_at, NEW.expires_at, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.key, OLD.allowance_id, OLD.platform_id, OLD.terms_version, OLD.terms_hash,
    OLD.customer_ref, OLD.mode, OLD.setup_request_id, OLD.token_request_id, OLD.accepted_at, OLD.expires_at, OLD.created_at)
    THEN RAISE EXCEPTION 'immutable mandate identity'; END IF;
  IF NEW.version <> OLD.version + 1 OR NOT (
    (OLD.status = 'RESERVED' AND NEW.status = 'CREATING') OR
    (OLD.status = 'CREATING' AND NEW.status = 'AWAITING_APPROVAL') OR
    (OLD.status = 'AWAITING_APPROVAL' AND NEW.status = 'TOKENIZING') OR
    (OLD.status = 'TOKENIZING' AND NEW.status = 'SIGNED') OR
    (OLD.status = 'SIGNED' AND NEW.status = 'REVOKED'))
    THEN RAISE EXCEPTION 'invalid mandate transition'; END IF;
  IF (OLD.setup_id IS NOT NULL AND NEW.setup_id IS DISTINCT FROM OLD.setup_id) OR
    (OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id) OR
    (OLD.approval_url IS NOT NULL AND NEW.approval_url IS DISTINCT FROM OLD.approval_url) OR
    (OLD.payer_id IS NOT NULL AND NEW.payer_id IS DISTINCT FROM OLD.payer_id) OR
    (OLD.token_id IS NOT NULL AND NEW.token_id IS DISTINCT FROM OLD.token_id)
    THEN RAISE EXCEPTION 'immutable mandate provider identity'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_mandate_signature BEFORE INSERT OR UPDATE OR DELETE ON mandate_signatures
FOR EACH ROW EXECUTE FUNCTION guard_mandate_signature();
--> statement-breakpoint
CREATE FUNCTION guard_mandate_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_signature mandate_signatures%ROWTYPE;
DECLARE expected jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'mandate events are append-only'; END IF;
  SELECT * INTO current_signature FROM mandate_signatures WHERE key = NEW.key FOR UPDATE;
  IF NOT FOUND OR NEW.version <> current_signature.version OR NEW.status <> current_signature.status
    THEN RAISE EXCEPTION 'mandate event must match current phase'; END IF;
  IF NEW.version = 0 AND NEW.status <> 'RESERVED' THEN RAISE EXCEPTION 'first mandate event must reserve'; END IF;
  expected := jsonb_build_object('key', current_signature.key, 'allowanceId', current_signature.allowance_id,
    'platformId', current_signature.platform_id, 'termsVersion', current_signature.terms_version,
    'termsHash', current_signature.terms_hash, 'customerRef', current_signature.customer_ref,
    'mode', current_signature.mode, 'status', current_signature.status, 'version', current_signature.version,
    'setupRequestId', current_signature.setup_request_id, 'tokenRequestId', current_signature.token_request_id,
    'setupId', current_signature.setup_id, 'customerId', current_signature.customer_id,
    'payerId', current_signature.payer_id, 'tokenId', current_signature.token_id,
    'approvalUrl', current_signature.approval_url, 'acceptedAt', current_signature.accepted_at,
    'expiresAt', current_signature.expires_at);
  IF NEW.snapshot - 'createdAt' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'invalid mandate event snapshot'; END IF;
  IF jsonb_typeof(NEW.snapshot->'createdAt') IS DISTINCT FROM 'string' OR
    (NEW.snapshot->>'createdAt')::timestamptz IS DISTINCT FROM current_signature.created_at
    THEN RAISE EXCEPTION 'invalid mandate creation time'; END IF;
  NEW.created_at := clock_timestamp();
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guard_mandate_event BEFORE INSERT OR UPDATE OR DELETE ON mandate_events
FOR EACH ROW EXECUTE FUNCTION guard_mandate_event();
--> statement-breakpoint
ALTER TABLE mandate_signatures ADD CONSTRAINT mandate_phase_requires_event
FOREIGN KEY (key, version) REFERENCES mandate_events(key, version) DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint
CREATE TRIGGER prevent_mandate_truncation BEFORE TRUNCATE ON mandate_signatures
FOR EACH STATEMENT EXECUTE FUNCTION guard_mandate_signature();
--> statement-breakpoint
CREATE TRIGGER prevent_mandate_event_truncation BEFORE TRUNCATE ON mandate_events
FOR EACH STATEMENT EXECUTE FUNCTION guard_mandate_event();
