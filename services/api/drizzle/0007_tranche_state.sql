CREATE TABLE "tranche_commands" (
	"tranche_id" text NOT NULL,
	"command_id" text NOT NULL,
	"version" integer NOT NULL,
	"command" jsonb NOT NULL,
	"record" text NOT NULL,
	CONSTRAINT "tranche_commands_tranche_id_version_pk" PRIMARY KEY("tranche_id","version"),
	CONSTRAINT "tranche_command_identity" UNIQUE("tranche_id","command_id"),
	CONSTRAINT "tranche_command_valid" CHECK ("tranche_commands"."version" > 0 AND length(trim("tranche_commands"."command_id")) > 0 AND jsonb_typeof("tranche_commands"."command") = 'object')
);
--> statement-breakpoint
ALTER TABLE "payment_streams" ADD COLUMN "record" text;--> statement-breakpoint
ALTER TABLE "payment_streams" ADD COLUMN "initial_record" text;--> statement-breakpoint
ALTER TABLE "tranche_commands" ADD CONSTRAINT "tranche_commands_tranche_id_payment_streams_tranche_id_fk" FOREIGN KEY ("tranche_id") REFERENCES "public"."payment_streams"("tranche_id") ON DELETE no action ON UPDATE no action;
