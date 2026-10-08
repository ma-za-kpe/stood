ALTER TABLE "reconciliation_findings" ADD COLUMN "resolved_by" text;--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "finding_person_resolution_valid" CHECK ("reconciliation_findings"."resolved_by" IS NULL OR (length(trim("reconciliation_findings"."resolved_by")) > 0 AND length(trim(coalesce("reconciliation_findings"."resolution_note", ''))) > 0 AND "reconciliation_findings"."status" = 'RESOLVED'));
