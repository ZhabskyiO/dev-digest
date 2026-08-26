import type { SkillCase } from "../../src/index.js";

export const cases: SkillCase[] = [
  {
    name: "drafts a Conventional Commits title and an honest PR body, and asks for go-ahead before opening",
    kind: "quality",
    prompt:
      "Branch Lab-5/cost-column has 3 commits: it adds a `cost_usd` column to the runs table with a migration, " +
      "shows the cost on the PR list and the run drawer in the client, and updates the shared contract in " +
      "server/src/vendor/shared (I also copied it to client/src/vendor/shared). I ran `pnpm typecheck` in " +
      "server and client (both green) but did NOT run the test suites. Prepare the PR.",
    practices: [
      "the proposed title follows <type>(<scope>): <imperative summary> in lowercase without a trailing period, e.g. feat(client): show run cost on the PR list and run drawer (or a repo-wide scope with justification)",
      "the 'How has this been tested?' section lists only pnpm typecheck as run and explicitly states the test suites were not run — it does not invent test results",
      "the answer reminds that the migration must have been applied with cd server && pnpm db:migrate (migrations never run on boot) and that both vendor/shared copies must be in sync",
      "the answer does not run gh pr create / push on its own — it asks for the user's explicit go-ahead for this PR and mentions running the pr-self-review gate first",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
