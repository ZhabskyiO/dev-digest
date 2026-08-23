import type { SkillCase } from "../../src/index.js";

const SCHEMA = `import { z } from "zod";

export interface CreateReview { repoId: string; prNumber: number; reviewers: string[]; mode: string }

export const createReviewSchema = z.object({
  repoId: z.string(),
  prNumber: z.any(),
  reviewers: z.array(z.string()).optional(),
  mode: z.string(),
  extra: z.any().optional(),
});

export function handle(body: unknown) {
  const data = createReviewSchema.parse(body);
  if (data.mode !== "fast" && data.mode !== "deep") throw new Error("bad mode");
  return data as CreateReview;
}`;

export const cases: SkillCase[] = [
  {
    name: "review replaces z.any, a string-typed enum, a manual interface and parse() on user input",
    kind: "quality",
    prompt: `Review this Zod code used to validate a request body and rewrite it.\n\n${SCHEMA}`,
    practices: [
      "replaces z.any() for prNumber with a concrete schema (z.number().int().positive(), or z.coerce.number() if it arrives as a query/form string) and replaces z.any() for extra with z.unknown()",
      "replaces mode: z.string() + the manual if-check with z.enum(['fast', 'deep'])",
      "removes the hand-written CreateReview interface in favour of export type CreateReview = z.infer<typeof createReviewSchema>, exporting both the schema and the type",
      "replaces parse() on the untrusted body with safeParse() and handles the failure branch (all issues, e.g. via error.flatten()) instead of letting it throw",
      "adds string validations at the schema (e.g. repoId .min(1) or a uuid/format) rather than checking later",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
