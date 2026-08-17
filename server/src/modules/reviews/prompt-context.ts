import type { Container } from '../../platform/container.js';
import type { UnifiedDiff } from '@devdigest/shared';

/**
 * Prompt-context builders — the repo-intel enrichment and skill resolution that
 * sit between "we have a diff" and the `reviewPullRequest` call.
 *
 * Lifted verbatim out of `ReviewRunExecutor`'s private methods so the local
 * (no-PR) review path in `local-review.ts` runs the SAME enrichment as a PR
 * run instead of growing a second copy. Behaviour is unchanged: every builder
 * is best-effort and returns `undefined` / `''` rather than throwing, so an
 * unindexed repo or a repo-intel failure degrades the prompt instead of failing
 * the review.
 *
 * Everything here reads `container` only — no persistence, no run ids. The
 * per-run side effect that used to live inside the skills step (writing
 * `run_skills`) stays with the caller that has a run id.
 */

/**
 * Minimal log sink. `RunLogger` satisfies it structurally, and the local review
 * path passes a plain collector — neither module needs to know about the other.
 */
export type StepLog = { info(msg: string, data?: unknown): void };

/**
 * Build a compact "Callers of changed symbols" digest for the prompt.
 *
 * Returns `undefined` when nothing should be added (no changed files, no
 * callers found, or repo-intel errors) — `reviewPullRequest` omits the section
 * in that case.
 *
 * Compact format: one bullet per caller, grouped by file. Trimmed (limit 10
 * rows per `getCallerSignatures` call) so the section stays under ~600 tokens
 * even on heavy diffs.
 */
export async function buildCallersDigest(
  container: Container,
  repoId: string,
  diff: UnifiedDiff,
  log: StepLog,
): Promise<string | undefined> {
  const changedFiles = diff.files.map((f) => f.path);
  if (changedFiles.length === 0) return undefined;
  let rows;
  try {
    rows = await container.repoIntel.getCallerSignatures(repoId, changedFiles, 10);
  } catch (err) {
    // Never let an enrichment break the run — surface only as a log line.
    log.info(`callers digest: repoIntel failed — ${(err as Error).message}`);
    return undefined;
  }
  if (rows.length === 0) return undefined;

  const byFile = new Map<string, string[]>();
  for (const r of rows) {
    const lines = byFile.get(r.file) ?? [];
    lines.push(`- \`${r.symbol}\` — ${r.signature}`);
    byFile.set(r.file, lines);
  }
  const out: string[] = [];
  for (const [file, lines] of byFile) {
    out.push(`### ${file}`);
    out.push(...lines);
  }
  log.info(`callers digest: ${rows.length} caller signature(s) attached`);
  return out.join('\n');
}

/**
 * Fetch the cached repo skeleton for the prompt's `## Repo skeleton` slot.
 * Returns `undefined` when repo-intel is off / the repo isn't indexed (the
 * facade degrades), so the prompt stays identical to the repo-intel-off shape.
 */
export async function buildRepoMapDigest(
  container: Container,
  repoId: string,
  log: StepLog,
): Promise<string | undefined> {
  try {
    const map = await container.repoIntel.getRepoMap(repoId);
    if (map.degraded || map.text.trim().length === 0) return undefined;
    log.info(`repo map: ${map.tokens} token(s) attached (cached=${map.cached})`);
    return map.text;
  } catch (err) {
    log.info(`repo map: repoIntel failed — ${(err as Error).message}`);
    return undefined;
  }
}

/**
 * A one-line "N of M changed files are in the top 5% most-depended-on" note
 * appended to the task framing, so the model prioritises hot core files. Empty
 * string when repo-intel is off / no changed file is hot.
 */
export async function buildRankNote(
  container: Container,
  repoId: string,
  diff: UnifiedDiff,
  log: StepLog,
): Promise<string> {
  const changedFiles = diff.files.map((f) => f.path);
  if (changedFiles.length === 0) return '';
  try {
    const ranks = await container.repoIntel.getFileRank(repoId, changedFiles);
    if (ranks.length === 0) return '';
    const hot = ranks.filter((r) => r.percentile >= 95);
    if (hot.length === 0) return '';
    log.info(`file rank: ${hot.length}/${changedFiles.length} changed file(s) in top 5%`);
    return `\n\n${hot.length} of ${changedFiles.length} changed file(s) are in the top 5% most-depended-on (high blast risk) — prioritise their correctness.`;
  } catch {
    return '';
  }
}

/** An agent's linked skills that are ALSO globally enabled, still in `order`. */
export type ResolvedSkills = {
  /** Skill bodies, ordered — what `reviewPullRequest` receives. */
  bodies: string[];
  /** Skill ids, same order — what per-run attribution (`run_skills`) records. */
  ids: string[];
  /** How many skills are linked to the agent in total (enabled or not). */
  linkedCount: number;
};

/**
 * Resolve the skills that go into an agent's prompt.
 *
 * BOTH gates must hold (attached to this agent AND globally enabled) — that's
 * what makes an unvetted/disabled import inert without unlinking it. Callers
 * with a run id additionally record `ids` via `skillsRepo.recordRunSkills`.
 */
export async function resolveAgentSkills(
  container: Container,
  agentId: string,
): Promise<ResolvedSkills> {
  const linked = await container.agentsRepo.linkedSkills(agentId);
  const enabled = linked.filter((l) => l.skill.enabled === true);
  return {
    bodies: enabled.map((l) => l.skill.body),
    ids: enabled.map((l) => l.skill.id),
    linkedCount: linked.length,
  };
}
