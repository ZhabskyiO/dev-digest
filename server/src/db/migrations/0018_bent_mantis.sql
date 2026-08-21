CREATE TABLE "pr_file_summary" (
	"pr_id" uuid NOT NULL,
	"path" text NOT NULL,
	"head_sha" text NOT NULL,
	"summary" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pr_file_summary_pr_id_path_pk" PRIMARY KEY("pr_id","path"),
	CONSTRAINT "pr_file_summary_len_chk" CHECK (length("pr_file_summary"."summary") <= 200)
);
--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "head_sha" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "tokens_in" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "tokens_out" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "cost_usd" double precision;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "generated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_file_summary" ADD CONSTRAINT "pr_file_summary_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;