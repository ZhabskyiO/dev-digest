import type { SkillCase } from "../../src/index.js";

const DDL = `CREATE TABLE "Reviews" (
  id serial PRIMARY KEY,
  repoId integer,
  title varchar(255),
  price money,
  created timestamp DEFAULT now(),
  status varchar(20) CHECK (status IN ('queued','running','done')),
  tags json
);
ALTER TABLE "Reviews" ADD FOREIGN KEY (repoId) REFERENCES repos(id);`;

export const cases: SkillCase[] = [
  {
    name: "review of a DDL snippet catches serial, varchar, money, timestamp, quoted identifiers, missing FK index",
    kind: "quality",
    prompt: `Review this PostgreSQL table and rewrite it following best practices.\n\n${DDL}`,
    practices: [
      "replaces serial with BIGINT GENERATED ALWAYS AS IDENTITY",
      "replaces varchar(n) with TEXT (with a CHECK on length if a limit is really needed) and money with NUMERIC",
      "replaces timestamp with TIMESTAMPTZ",
      "replaces the quoted mixed-case identifiers (\"Reviews\", repoId) with unquoted snake_case names (reviews, repo_id)",
      "adds an explicit index on the foreign-key column repo_id and an ON DELETE action on the FK, noting PostgreSQL does not auto-index FK columns",
      "changes json to JSONB (or a normalized table) and adds NOT NULL where semantically required (repo_id, status, created_at)",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
