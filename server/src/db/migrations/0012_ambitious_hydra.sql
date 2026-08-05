CREATE TABLE "run_skills" (
	"run_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"order" integer NOT NULL,
	CONSTRAINT "run_skills_run_id_skill_id_pk" PRIMARY KEY("run_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "run_skills" ADD CONSTRAINT "run_skills_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_skills" ADD CONSTRAINT "run_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_skills_skill_id_idx" ON "run_skills" USING btree ("skill_id");--> statement-breakpoint
CREATE INDEX "skills_workspace_id_idx" ON "skills" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_skills_skill_id_idx" ON "agent_skills" USING btree ("skill_id");