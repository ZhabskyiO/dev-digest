import type { ConventionCandidateDetail } from "@devdigest/shared";

/** Words too generic to make a rule's slug recognisable. */
const STOP_WORDS = new Set([
  "always",
  "never",
  "use",
  "using",
  "the",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "for",
  "and",
  "or",
  "with",
  "instead",
  "prefer",
  "should",
  "must",
  "do",
  "not",
]);

/**
 * Short kebab heading for one rule, e.g. "Always use async/await instead of
 * .then() chains." → `async-await-then-chains`. Purely cosmetic: it gives the
 * skill body scannable section headings instead of a wall of bullets.
 */
export function ruleSlug(rule: string): string {
  const words = rule
    .toLowerCase()
    .replace(/[^a-z0-9\s/]/g, " ")
    .replace(/\//g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .slice(0, 4);
  return words.length > 0 ? words.join("-") : "convention";
}

/** `path` + `:line` when the line is known. */
export function evidenceRef(candidate: ConventionCandidateDetail): string {
  return candidate.evidence_line === null
    ? candidate.evidence_path
    : `${candidate.evidence_path}:${candidate.evidence_line}`;
}

/**
 * Compose the initial markdown body for a skill built from accepted candidates:
 * one section per rule, each carrying the citation and the snippet it was
 * grounded against, so a reviewer reading the assembled prompt can see where
 * the rule came from.
 *
 * This is only a starting point — the modal lets the user rewrite it, and the
 * server stores whatever comes back verbatim.
 */
export function composeSkillBody(
  name: string,
  repoName: string,
  candidates: ConventionCandidateDetail[],
): string {
  const intro = `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`;

  const sections = candidates.map((c) => {
    const lines = [`## ${ruleSlug(c.rule)}`, c.rule, "", `Detected in \`${evidenceRef(c)}\`:`];
    if (c.evidence_snippet.trim()) {
      lines.push("", "```", c.evidence_snippet, "```");
    }
    return lines.join("\n");
  });

  return [`# ${name}`, "", intro, "", ...sections.flatMap((sec) => [sec, ""])]
    .join("\n")
    .trimEnd();
}
