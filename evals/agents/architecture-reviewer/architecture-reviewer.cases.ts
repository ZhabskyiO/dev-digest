import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

// Shared by architecture-reviewer AND architecture-reviewer-lite (the lite suite re-exports
// these cases) so the two agents are measured on identical prompts and practices. Both agents
// run with the tools they declare (Read, Glob, Grep) from the repo root, so they can open the
// real CLAUDE.md files; the diff under review is inlined from fixtures/.

const fx = fixtureReader(import.meta.url);

const review = (what: string, diff: string) =>
  `Review this diff against DevDigest's documented architecture rules and produce your report.\n\n${what}\n\n\`\`\`diff\n${diff}\n\`\`\``;

export const cases: AgentCase[] = [
  {
    name: "checkout module: catches layering, DI, process.env and fat-route violations with verbatim evidence",
    kind: "quality",
    prompt: review(
      "New `checkout` module under server/src/modules/checkout plus a Stripe adapter. Files: adapters/payments/stripe.ts, modules/checkout/{service,routes,repository}.ts.",
      fx("checkout-service.diff"),
    ),
    grounding: ["Gate"],
    practices: [
      "flags `import type { FastifyRequest } from 'fastify'` in server/src/modules/checkout/service.ts under rule inward-only-dependencies (the Application layer importing a transport type), severity critical or high",
      "flags `new StripeClient(...)` inside service.ts under rule di-discipline (construction outside platform/container.ts)",
      "flags `process.env.STRIPE_SECRET_KEY` in service.ts under rule no-process-env-outside-secrets-provider",
      "flags the `db.select().from(orders)` / `db.update(orders)` queries and the refund branching inside routes.ts under rule business-logic-in-routes",
      "the evidence column quotes the offending statements verbatim (an import line, the `new StripeClient(` expression, a `db.select()` call), not paraphrases",
      "the verdict is Gate: FAIL, and repository.ts is NOT reported as a violation (a repository may import drizzle-orm and db/schema)",
      "recommendations are prose — the report contains no rewritten or 'fixed' code (quoting the original offending line, even in a code fence, is fine) — and it never claims that a file was edited",
    ],
    threshold: 0.6,
    maxTurns: 12,
  },
  {
    name: "benign refactor: passes a clean extraction without inventing violations",
    kind: "quality",
    prompt: review(
      "Refactor in server/src/modules/repos: slug parsing extracted from service.ts into a pure helpers.ts, a new case-insensitive lookup in repository.ts, and a unit test for the helper.",
      fx("benign-refactor.diff"),
    ),
    grounding: ["Gate"],
    practices: [
      "the verdict is Gate: PASS with zero critical and zero high findings",
      "no finding cites a rule against helpers.ts, the service's use of the helper, or the repository's drizzle-orm/sql import — none of these contradict a documented rule",
      "the audited files are listed (helpers.ts, service.ts, repository.ts, helpers.test.ts)",
      "the answer does not pad the report with generic style or naming advice presented as findings (info-level notes are acceptable)",
    ],
    threshold: 0.6,
    maxTurns: 12,
  },
  {
    name: "reviewer-core: catches node:fs I/O and the grounding bypass as critical, citing reviewer-core/CLAUDE.md",
    kind: "quality",
    // Behaviour-shaped: demands the agent actually RUN its method (read the
    // authoritative docs, audit beyond the first visible hunk, emit the full
    // report format). Measured on CI run 32910822439 (google/gemini-2.5-flash):
    // the full agent one-shots in 1 turn with 0 tool calls (218 output tokens),
    // finds only the fs import and scores 0.2/0.4; lite lands exactly at the
    // 0.6 threshold with the same no-tool behaviour. On the Anthropic path the
    // agent engages the tool loop and the case asserts for real — so it runs
    // there and skips (visibly) on non-anthropic backends.
    indicative: true,
    prompt: review(
      "Change to reviewer-core/src/review/run.ts adding debugging options to the review pipeline.",
      fx("reviewer-core-gate.diff"),
    ),
    grounding: ["Gate"],
    practices: [
      "flags `import { readFileSync, writeFileSync } from 'node:fs'` in reviewer-core/src/review/run.ts under rule reviewer-core-zero-io with severity critical",
      "flags the `if (opts.skipGrounding) { return { findings, score: raw.score, ... } }` path under rule reviewer-core-ground-findings-gate with severity critical, noting it returns the model's self-reported score without groundFindings()",
      "the source cited for both findings is reviewer-core/CLAUDE.md (no I/O except the injected LLMProvider; grounding is the mandatory gate)",
      "the verdict is Gate: FAIL with at least 2 critical findings",
      "the recommendation for the I/O finding keeps reviewer-core pure (move dumping/hints to the server side or behind the injected provider), not 'wrap it in try/catch'",
    ],
    threshold: 0.6,
    maxTurns: 12,
  },
];
