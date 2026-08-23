/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   any CLAUDE.md (root, .claude/, or a package's) / any agent / engine change
 *     / a skill or agent that the workflow cases reference       → run the workflow tier
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs so the job can print a visible "SKIP <name> (no evals)" line instead of going red.
 *
 * Emits GitHub Actions step outputs (skills, agents, run_workflow, skipped_skills, skipped_agents)
 * to $GITHUB_OUTPUT. Pure filesystem + string work — no deps.
 */

import { existsSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(EVALS_DIR, "..");

const changed = (process.env.CHANGED_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
function hasEvals(tier, name) {
  const dir = join(EVALS_DIR, tier, name);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".eval.ts"));
}

/** Collect distinct artifact names touched under a `.claude` and/or `evals` prefix. */
function touched(reClaude, reEvals) {
  const names = new Set();
  for (const f of changed) {
    const m = f.match(reClaude) ?? f.match(reEvals);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const skillNames = touched(
  /^\.claude\/skills\/([^/]+)\//,
  /^evals\/skills\/([^/]+)\//,
);
const agentNames = touched(
  /^\.claude\/agents\/([^/]+)\.md$/,
  /^evals\/agents\/([^/]+)\//,
);

const skills = skillNames.filter((n) => hasEvals("skills", n));
const skippedSkills = skillNames.filter((n) => !hasEvals("skills", n));
const agents = agentNames.filter((n) => hasEvals("agents", n));
const skippedAgents = agentNames.filter((n) => !hasEvals("agents", n));

/**
 * Names the workflow cases reference (`skill: "x"`, `expectSkills: ["x"]`, `expectSubagent: "x"`,
 * `expectSubagents: [...]`, `expectAnySubagent: [...]`). A change to one of those artifacts must
 * re-run the workflow tier even when the artifact has no content-tier evals of its own.
 */
function workflowReferencedNames() {
  const dir = join(EVALS_DIR, "workflow");
  if (!existsSync(dir)) return new Set();
  const names = new Set();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".cases.ts"))) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/\b(?:skill|expectSubagent):\s*"([^"]+)"/g)) names.add(m[1]);
    for (const m of src.matchAll(/\b(?:expectSkills|expectSubagents|expectAnySubagent):\s*\[([^\]]*)\]/g)) {
      for (const n of m[1].matchAll(/"([^"]+)"/g)) names.add(n[1]);
    }
  }
  return names;
}

// The workflow tier measures the LIVE harness, so anything that changes it re-triggers it: any
// CLAUDE.md (the root one, .claude/, or a package's — the cases assert per-package routing), any
// agent definition, the workflow cases, the engine itself, or a skill/agent the cases reference.
const referenced = workflowReferencedNames();
const runWorkflow =
  changed.some(
    (f) =>
      /^(?:[^/]+\/)?CLAUDE\.md$/.test(f) ||
      f === ".claude/CLAUDE.md" ||
      /^\.claude\/agents\/.+\.md$/.test(f) ||
      /^evals\/workflow\//.test(f) ||
      /^evals\/src\//.test(f) ||
      /^evals\/(?:vitest\.config\.ts|package\.json)$/.test(f),
  ) || [...skillNames, ...agentNames].some((n) => referenced.has(n));

const out = process.env.GITHUB_OUTPUT;
const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

write("skills", JSON.stringify(skills));
write("agents", JSON.stringify(agents));
write("run_workflow", String(runWorkflow));
write("skipped_skills", skippedSkills.join(" "));
write("skipped_agents", skippedAgents.join(" "));

// Human-readable summary in the step log.
console.error("── eval change detection ──");
console.error(`changed files : ${changed.length}`);
console.error(`skills → run  : ${skills.join(", ") || "(none)"}`);
console.error(`agents → run  : ${agents.join(", ") || "(none)"}`);
console.error(`workflow tier : ${runWorkflow ? "run" : "skip"}`);
if (skippedSkills.length) console.error(`SKIP skills (no evals): ${skippedSkills.join(", ")}`);
if (skippedAgents.length) console.error(`SKIP agents (no evals): ${skippedAgents.join(", ")}`);
