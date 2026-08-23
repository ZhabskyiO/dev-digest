import type { SkillCase } from "../../src/index.js";

const CODE = `type Status = "queued" | "running" | "done" | "failed";

export function label(s: Status) {
  switch (s) {
    case "queued": return "Queued";
    case "running": return "Running";
    case "done": return "Done";
  }
}

export async function loadRun(id: string): Promise<any> {
  const res = await fetch("/api/runs/" + id);
  const json = await res.json();
  return json as Run;
}

export function findingsOf(run: any) {
  return (run.findings as Finding[]).filter((f: any) => f.severity == "high");
}

export type RunId = string;
export type RepoId = string;
export function attach(run: RunId, repo: RepoId) { return repo + ":" + run; }`;

export const cases: SkillCase[] = [
  {
    name: "review catches non-exhaustive switch, any leakage, unjustified assertions, and unbranded id primitives",
    kind: "quality",
    prompt: `Review this TypeScript for type-safety problems and show the fixes.\n\n${CODE}`,
    practices: [
      "flags the switch over Status as non-exhaustive ('failed' falls through to undefined) and adds a default branch with an exhaustiveness check using never",
      "flags Promise<any> and run: any as implicit-any leakage and replaces them with unknown + a type guard / validation, or a proper Run type",
      "flags json as Run as an unjustified type assertion on untrusted data and recommends runtime validation (e.g. a Zod schema or a type predicate) instead",
      "flags RunId / RepoId as interchangeable string aliases (attach(run, repo) can silently swap them) and proposes branded types",
      "suggests explicit return types for the exported functions",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
