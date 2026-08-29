ALTER TABLE "ci_installations" ADD COLUMN "agent_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "base_branch" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "post_as" text DEFAULT 'github_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "triggers" jsonb DEFAULT '["opened","synchronize","reopened"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "workflow_run_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "duration_s" double precision;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "error" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_installations_agent_repo_uniq" ON "ci_installations" USING btree ("agent_id","repo");--> statement-breakpoint
CREATE INDEX "ci_installations_repo_idx" ON "ci_installations" USING btree ("repo");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_workflow_run_id_uniq" ON "ci_runs" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "ci_runs_installation_ran_at_idx" ON "ci_runs" USING btree ("ci_installation_id","ran_at" DESC NULLS LAST);