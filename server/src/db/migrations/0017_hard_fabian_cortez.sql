CREATE TABLE "context_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"skill_id" uuid,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	"attached_hash" text NOT NULL,
	"attached_size" integer NOT NULL,
	"attached_revision" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "context_attachments_target_chk" CHECK (("context_attachments"."agent_id" IS NOT NULL) <> ("context_attachments"."skill_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "project_context_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_hash" text NOT NULL,
	"tokens" integer NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_context_documents_type_chk" CHECK ("project_context_documents"."type" IN ('specs','docs','insights'))
);
--> statement-breakpoint
ALTER TABLE "skill_versions" ADD COLUMN "attachments" jsonb;--> statement-breakpoint
ALTER TABLE "context_attachments" ADD CONSTRAINT "context_attachments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_attachments" ADD CONSTRAINT "context_attachments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_attachments" ADD CONSTRAINT "context_attachments_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_attachments" ADD CONSTRAINT "context_attachments_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_context_documents" ADD CONSTRAINT "project_context_documents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "context_attachments_agent_repo_path_uq" ON "context_attachments" USING btree ("agent_id","repo_id","path") WHERE "context_attachments"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "context_attachments_skill_repo_path_uq" ON "context_attachments" USING btree ("skill_id","repo_id","path") WHERE "context_attachments"."skill_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "context_attachments_repo_path_idx" ON "context_attachments" USING btree ("repo_id","path");--> statement-breakpoint
CREATE INDEX "context_attachments_skill_id_idx" ON "context_attachments" USING btree ("skill_id") WHERE "context_attachments"."skill_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "project_context_documents_repo_path_uq" ON "project_context_documents" USING btree ("repo_id","path");