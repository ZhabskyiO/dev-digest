import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "picks a sequence diagram for an API flow, labels messages, keeps it small and valid",
    kind: "quality",
    prompt:
      "Draw the flow when a user clicks 'Review PR' in our web app: the browser calls POST /reviews on the " +
      "Fastify API, the API fetches the diff from GitHub, runs reviewer-core which calls the LLM provider, " +
      "stores findings in Postgres, and the browser gets updates over SSE until the run completes.",
    grounding: ["```mermaid"],
    practices: [
      "the diagram uses sequenceDiagram (participants over time), not a flowchart — and the answer says why a sequence diagram fits an API call flow",
      "every arrow carries a message label (e.g. 'POST /reviews', 'GET diff', 'findings'), no unlabeled arrows",
      "the diagram has at most ~6 participants (browser, API, GitHub, reviewer-core, LLM, Postgres) and stays well under 20 elements — it does not sprawl",
      "the SSE streaming phase is shown as a loop or repeated dashed return messages until completion, rather than a single response arrow",
      "the diagram is wrapped in a ```mermaid fenced block and uses valid syntax (participant declarations, ->> / -->> arrows)",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
