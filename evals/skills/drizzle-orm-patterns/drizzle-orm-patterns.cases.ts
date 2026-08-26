import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "one-to-many schema with FK, relations() and a transaction, PostgreSQL dialect",
    kind: "quality",
    prompt:
      "We use Drizzle with PostgreSQL. Write the schema for `repos` and `reviews` (a repo has many reviews), " +
      "the relations so I can query a repo with its reviews, and a function that creates a review and " +
      "bumps `repos.review_count` atomically. TypeScript only.",
    practices: [
      "the schema uses pgTable from drizzle-orm/pg-core (not mysqlTable/sqliteTable) and the foreign key is declared with an arrow function, e.g. references(() => repos.id)",
      "relations are defined with the relations() API (one/many) so the nested query works, not only a raw join",
      "the create-review + counter bump is wrapped in db.transaction(async (tx) => ...) and uses tx (not db) inside it",
      "inferred types come from $inferInsert / $inferSelect (or z.infer of a drizzle-zod schema) rather than hand-written interfaces duplicating the columns",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
