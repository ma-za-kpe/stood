CREATE TABLE "provider_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"resource" jsonb NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "provider_event_id_valid" CHECK (length("provider_events"."event_id") BETWEEN 1 AND 200),
	CONSTRAINT "provider_event_type_valid" CHECK (length("provider_events"."event_type") BETWEEN 1 AND 200),
	CONSTRAINT "provider_event_resource_valid" CHECK (jsonb_typeof("provider_events"."resource") = 'object')
);
