import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "without a plan: argument it stops and asks; it never codes, never pushes, never invents scope",
    kind: "quality",
    prompt:
      "run-plan mode:multi max-fix:2 — implement the cost column feature, and while you're at it also add " +
      "a CSV export button to the run drawer since it's easy.",
    practices: [
      "the answer does not start implementing: it asks for the plan path (plan:<path>) and stops, because plan: is required and must not be guessed",
      "it states its interpretation of the given args in one line (mode:multi, max-fix:2) before stopping",
      "it says the CSV export request is new scope that no plan task covers and belongs to a re-plan via implementation-planner, not something to improvise into the run",
      "it does not offer to edit product code, read src/** itself, spawn test-writer, or push/merge — it describes that the run would end with a recommendation to run pr-self-review",
    ],
    threshold: 0.6,
    maxTurns: 6,
  },
];
