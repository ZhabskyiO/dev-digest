import type { SkillCase } from "../../src/index.js";

const RUN = `In-context usage for the run labelled "cost-column":
- spec-creator: 18,200 in / 4,100 out, cache-read 12,000, 14 tool calls, 210 s (it spawned 3 researcher sub-agents — their usage is not in this number)
- implementation-planner: 22,900 in / 5,300 out, cache-read 15,500, 9 tool calls, 180 s
- implementer-backend: 31,000 in / 6,900 out, cache-read 9,000, 41 tool calls, 420 s
- implementer-ui: 27,400 in / 6,100 out, cache-read 8,700, 37 tool calls, 390 s (ran in parallel with implementer-backend)
- architecture-reviewer: 9,800 in / 1,200 out, 6 tool calls, 60 s
Both implementers independently read CLAUDE.md, server/CLAUDE.md, client/CLAUDE.md and docs/api-contracts.md in full (~6,000 tokens each).
The architecture-reviewer found one CRITICAL (a service importing an adapter) that the implementer's own self-check missed.`;

export const cases: SkillCase[] = [
  {
    name: "retro report counts nested agents, flags duplicated context, gives actionable recommendations, appends a ledger row",
    kind: "quality",
    prompt: `/workflow-retro label:cost-column\n\n${RUN}`,
    grounding: ["## Workflow Retro"],
    practices: [
      "the agent count includes the 3 nested researcher sub-agents (8 agents, not 5) or the report explicitly states that the in-context totals exclude the nested agents and recommends deep mode",
      "the Metrics section is a per-agent table followed by totals, launch order (spec-creator → implementation-planner → (implementer-backend ‖ implementer-ui) → architecture-reviewer) and the critical path",
      "the duplicated reading of CLAUDE.md / api-contracts.md by both implementers is called out as wasted context with an approximate token figure, and a recommendation to pre-fetch or summarize it once in the brief",
      "the missed CRITICAL is listed under 'what was missed' with who caught it, and a recommendation targets the implementer-backend brief or self-check",
      "the report ends with a Ledger line describing the single row appended to docs/retros/ledger.md, and nothing in the answer proposes wiring the retro to a hook or running it automatically",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
