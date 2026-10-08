ALTER TABLE "funding_operations" DROP CONSTRAINT "funding_order_required";--> statement-breakpoint
ALTER TABLE "funding_operations" ADD CONSTRAINT "funding_order_required" CHECK ("funding_operations"."status" NOT IN ('AWAITING_APPROVAL', 'AUTHORIZING', 'HELD', 'EXPIRED') OR ("funding_operations"."order_id" IS NOT NULL AND length(trim("funding_operations"."order_id")) > 0 AND ("funding_operations"."approval_url" IS NOT NULL OR ("funding_operations"."status" = 'HELD' AND "funding_operations"."instruction"->>'source' = 'SAVED_PAYPAL'))));--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_funding_operation() RETURNS trigger LANGUAGE plpgsql AS $$
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
          (OLD.status = 'AUTHORIZING' AND NEW.status IN ('HELD', 'FAILED', 'EXPIRED')) OR
          -- T-0154: a saved PayPal account is authorized when the order is created.
          (OLD.status = 'CREATING' AND NEW.status IN ('HELD', 'FAILED') AND OLD.instruction->>'source' = 'SAVED_PAYPAL')) THEN
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
