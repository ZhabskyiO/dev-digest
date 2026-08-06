import type { ConventionCandidateDetail, ConventionCategory } from "@devdigest/shared";
import { CATEGORY_COLOR, SKILL_NAME_SUFFIX, type StatusFilter } from "./constants";


export function categoryColor(category: ConventionCategory): string {
  return CATEGORY_COLOR[category] ?? CATEGORY_COLOR.other;
}

export function filterByStatus(
  candidates: ConventionCandidateDetail[],
  filter: StatusFilter,
): ConventionCandidateDetail[] {
  if (filter === "all") return candidates;
  return candidates.filter((c) => c.status === filter);
}

/** The candidates a skill is built from — accepting one is what opts it in. */
export function acceptedOf(
  candidates: ConventionCandidateDetail[],
): ConventionCandidateDetail[] {
  return candidates.filter((c) => c.status === "accepted");
}

export function formatEvidence(candidate: ConventionCandidateDetail): string {
  return candidate.evidence_line === null
    ? candidate.evidence_path
    : `${candidate.evidence_path}:${candidate.evidence_line}`;
}

/** `acme/payments-api` → `payments-api-conventions`. */
export function defaultSkillName(repoName: string): string {
  const bare = repoName.split("/").pop() ?? repoName;
  return `${bare}${SKILL_NAME_SUFFIX}`;
}

/** The fields of `Repo` a blob permalink needs — kept structural so the helper
 *  stays callable before the repo list has loaded. */
export interface BlobRepo {
  full_name: string;
  default_branch: string;
}

/**
 * GitHub permalink for a candidate's evidence, or null when the repo isn't
 * known yet. Points at the default branch rather than a pinned sha: the
 * evidence was sampled from the clone's current HEAD, and a branch URL keeps
 * working as the file moves, which is what someone clicking through wants.
 *
 * Path segments are encoded individually so `/` survives while spaces and `#`
 * in a filename don't break the fragment.
 */
export function githubBlobUrl(
  repo: BlobRepo | null | undefined,
  candidate: Pick<ConventionCandidateDetail, "evidence_path" | "evidence_line">,
): string | null {
  if (!repo?.full_name || !repo.default_branch) return null;
  if (!candidate.evidence_path) return null;
  const path = candidate.evidence_path.split("/").map(encodeURIComponent).join("/");
  const line = candidate.evidence_line === null ? "" : `#L${candidate.evidence_line}`;
  return `https://github.com/${repo.full_name}/blob/${repo.default_branch}/${path}${line}`;
}
