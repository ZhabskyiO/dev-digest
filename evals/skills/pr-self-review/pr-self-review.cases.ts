import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "plans the gate correctly: scope, deterministic gates first, bucket routing, critical verification, state file",
    kind: "quality",
    prompt:
      "I'm about to push. Changed files vs origin/main: server/src/modules/reviews/service.ts, " +
      "server/src/modules/reviews/repository.ts, server/src/vendor/shared/contracts/review.ts, " +
      "client/src/vendor/shared/contracts/review.ts, client/src/components/run-drawer/RunDrawer.tsx, " +
      "client/src/components/run-drawer/RunDrawer.test.tsx, server/pnpm-lock.yaml, docs/runs.md. " +
      "Walk me through exactly what the self-review will do, in order, and what blocks the push.",
    practices: [
      "step one reduces the scope: vendor/shared copies, the lockfile and the pure docs file are dropped from the reviewable set, leaving the server module files and the client component + test",
      "the deterministic gates (./scripts/verify.sh for server and client — typecheck + unit; depcruise where defined) run BEFORE any LLM review, and any non-zero exit means BLOCKED immediately",
      "files are routed into buckets: the client files to the UI bucket (frontend-architecture, react-best-practices, next-best-practices, react-testing-library for the test), the server files to the backend bucket plus the architecture-reviewer structural pass, with typescript-expert/zod/security applying to both",
      "only a CRITICAL that survives adversarial verification blocks the push; an unconfirmed CRITICAL is downgraded to HIGH and said so in the report",
      "the result is written to .pr-self-review.json with a diffHash from scripts/diff-hash.sh, which is what the PreToolUse hook checks on git push",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
