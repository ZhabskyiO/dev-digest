import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "routes a confirmed gotcha to the right module file and section, append-only, with a dated entry",
    kind: "quality",
    prompt:
      "Capture this: while debugging the pgvector search in server/src/modules/repo-intel/ we found that " +
      "`ORDER BY embedding <=> $1` silently returns zero rows when the query vector has 1536 dims but the " +
      "column was created with vector(768) — no error, just empty results. Fix was regenerating the " +
      "embeddings with the 768-dim model. Tell me exactly which file and section this goes to and show the " +
      "entry you would append. Today is 2026-08-22.",
    practices: [
      "the target file is server/insights/gotchas.md (the work touched server/src/modules/repo-intel, which routes to server/, and a silent failure is a gotcha) — not the root insights folder and not INSIGHTS.md",
      "the section chosen is 'What Doesn't Work' or 'Recurring Errors & Fixes', with a one-line reason",
      "the entry follows the format '- 2026-08-22 — <claim>' and states the dimension mismatch rule abstractly (vector column dimension must match the embedding model) rather than narrating the debugging story",
      "the answer says it would append with Edit (never Write/overwrite) and would not modify, reword or delete existing entries",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
