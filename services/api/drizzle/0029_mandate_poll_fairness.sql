ALTER TABLE "mandate_signatures" ADD COLUMN "last_polled_at" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mandate_signatures" ADD CONSTRAINT "mandate_poll_time_valid" CHECK ("mandate_signatures"."last_polled_at" >= 0 AND "mandate_signatures"."last_polled_at" <= 9007199254740991);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_mandate_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN RAISE EXCEPTION 'mandate history is immutable'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'RESERVED' OR NEW.version <> 0 THEN RAISE EXCEPTION 'reserve mandate before provider calls'; END IF;
    NEW.created_at := clock_timestamp();
    NEW.last_polled_at := 0;
    RETURN NEW;
  END IF;
  -- Queue position is scheduling metadata; changing it cannot change consent, its version or its audit facts.
  IF NEW.last_polled_at IS DISTINCT FROM OLD.last_polled_at THEN
    IF NEW.last_polled_at > OLD.last_polled_at AND
      (to_jsonb(NEW) - 'last_polled_at') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'last_polled_at')
      THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'invalid mandate scheduling update';
  END IF;
  IF ROW(NEW.key, NEW.allowance_id, NEW.platform_id, NEW.terms_version, NEW.terms_hash,
    NEW.customer_ref, NEW.mode, NEW.setup_request_id, NEW.token_request_id, NEW.accepted_at, NEW.expires_at, NEW.created_at)
    IS DISTINCT FROM ROW(OLD.key, OLD.allowance_id, OLD.platform_id, OLD.terms_version, OLD.terms_hash,
    OLD.customer_ref, OLD.mode, OLD.setup_request_id, OLD.token_request_id, OLD.accepted_at, OLD.expires_at, OLD.created_at)
    THEN RAISE EXCEPTION 'immutable mandate identity'; END IF;
  -- T-0227: a key rotation re-seals the same token (same fingerprint) and changes nothing else.
  IF NEW.version = OLD.version + 1 AND NEW.status = OLD.status AND OLD.status IN ('SIGNED', 'REVOKED')
    AND NEW.token_id IS DISTINCT FROM OLD.token_id AND NEW.token_fingerprint = OLD.token_fingerprint
    AND ROW(NEW.setup_id, NEW.customer_id, NEW.approval_url, NEW.payer_id)
      IS NOT DISTINCT FROM ROW(OLD.setup_id, OLD.customer_id, OLD.approval_url, OLD.payer_id)
    THEN RETURN NEW; END IF;
  IF OLD.token_fingerprint IS NOT NULL AND NEW.token_fingerprint IS DISTINCT FROM OLD.token_fingerprint
    THEN RAISE EXCEPTION 'immutable mandate provider identity'; END IF;
  IF NEW.version <> OLD.version + 1 OR NOT (
    (OLD.status = 'RESERVED' AND NEW.status = 'CREATING') OR
    (OLD.status = 'CREATING' AND NEW.status = 'AWAITING_APPROVAL') OR
    (OLD.status = 'AWAITING_APPROVAL' AND NEW.status = 'TOKENIZING') OR
    (OLD.status = 'TOKENIZING' AND NEW.status = 'SIGNED') OR
    (OLD.status = 'SIGNED' AND NEW.status = 'REVOKED') OR
    (OLD.status IN ('RESERVED', 'AWAITING_APPROVAL') AND NEW.status = 'REVOKED'))
    THEN RAISE EXCEPTION 'invalid mandate transition'; END IF;
  IF (OLD.setup_id IS NOT NULL AND NEW.setup_id IS DISTINCT FROM OLD.setup_id) OR
    (OLD.customer_id IS NOT NULL AND NEW.customer_id IS DISTINCT FROM OLD.customer_id) OR
    (OLD.approval_url IS NOT NULL AND NEW.approval_url IS DISTINCT FROM OLD.approval_url) OR
    (OLD.payer_id IS NOT NULL AND NEW.payer_id IS DISTINCT FROM OLD.payer_id) OR
    (OLD.token_id IS NOT NULL AND NEW.token_id IS DISTINCT FROM OLD.token_id)
    THEN RAISE EXCEPTION 'immutable mandate provider identity'; END IF;
  RETURN NEW;
END $$;
