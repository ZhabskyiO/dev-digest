import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import type { Container } from '../../platform/container.js';
import type { ProjectContextTraceItem, UnifiedDiff } from '@devdigest/shared';
import { planBudget } from '../_shared/context-budget.js';
import { resolveInClone } from '../_shared/clone-path-guard.js';

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

// ---------------------------------------------------------------------------
// Project context (T15 — AC-16, AC-20..AC-28, AC-44)
// ---------------------------------------------------------------------------

/** `reviewRepo.getRepo`'s resolved row shape, used only for its `clonePath`. */
type RepoRow = NonNullable<Awaited<ReturnType<Container['reviewRepo']['getRepo']>>>;

export interface ResolvedProjectContext {
  /** Document bodies, in persisted order. Passed verbatim as `specs` to
   *  `reviewPullRequest`/`assemblePrompt` — reviewer-core wraps each one
   *  (`wrapUntrusted('spec-N', …)`) and applies the injection guard itself.
   *  This module never wraps, never truncates the guard text, and never
   *  filters on content — only on outcome. */
  bodies: string[];
  /** The same documents' paths, in the same order, for the run trace's
   *  "Specs read" field (AC-30). */
  specsRead: string[];
  /** One entry per document in the effective context set, in persisted
   *  order, for the run trace's project-context detail (AC-29). */
  details: ProjectContextTraceItem[];
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Reads `relPath` against `realRoot` (already `realpath`-resolved) through
 * the shared `resolveInClone` containment guard (`../_shared/
 * clone-path-guard.js`), also used by `ProjectContextService`. Never throws —
 * returns `null` for anything that fails any check, which this function's
 * only caller treats as `missing` (AC-22).
 */
async function readClonePath(realRoot: string, relPath: string): Promise<Buffer | null> {
  const real = await resolveInClone(realRoot, relPath);
  if (real === null) return null;
  return readFile(real).catch(() => null);
}

/**
 * Resolves an agent's effective project-context set (AC-16) into what a
 * review run actually needs: ordered document bodies for the prompt's
 * `## Project context` slot, the paths read (for the trace's "Specs read"
 * field), and a per-document outcome for the run trace (AC-29). Consumed
 * identically by the PR path, the local (no-PR) path, and any future CI
 * path (AC-28) — this is the ONE place that decides what an LLM reads from
 * project context.
 *
 * Per document, in persisted order:
 *   1. `helpers.planBudget` runs FIRST, over the FULL effective document set
 *      (`effective.documents`, unfiltered) using each document's persisted
 *      token estimate — the exact same input `ProjectContextService.
 *      effectiveContext` budgets over for AC-40's `dropped_paths` preview.
 *      This is deliberate, not incidental: budgeting over a pre-filtered
 *      subset (as this function used to) let a `wrong_repo`/`missing`
 *      document silently "free up" budget space that the preview had
 *      already counted as spent, so the preview's `dropped_paths` and this
 *      function's `dropped_over_budget` set could name different documents
 *      for the same effective set. Calling `planBudget` on the identical
 *      input here is what makes `EffectiveProjectContext.dropped_paths`'s own
 *      contract doc ("the same tail... AC-23's run-time drop would produce")
 *      actually true.
 *   2. Only a document `planBudget` marks `injected` is examined further —
 *      `repo_id !== repoId` → `wrong_repo`, skip (AC-25). `repoId` is
 *      `undefined` for a local review with no resolved repo — every
 *      attachment is `wrong_repo` in that case, so the prompt is unchanged.
 *      A document `planBudget` already dropped is reported
 *      `dropped_over_budget` without a live filesystem check — spending an
 *      FS read (or a wrong-repo compare) on a document that can never be
 *      injected regardless of its own readability is wasted work.
 *   3. Read fresh from the clone (`readClonePath`'s resolve-then-recheck-
 *      after-realpath guard) → failure → `missing`, overriding the budget's
 *      `injected` verdict for that one document (AC-22).
 *   4. Hash the content JUST READ (never the last scan's stored hash — a
 *      run may happen with no rescan in between) and compare to the
 *      attachment's recorded `attached_hash` → differ → flag `changed: true`
 *      and still inject the new bytes (AC-44).
 *   5. Truncate to `config.projectContextDocCharCap` → flag `truncated: true`
 *      (AC-24).
 *
 * No model call anywhere (AC-27). The whole function is best-effort: an
 * empty effective set (or any unexpected throw — a DB error resolving the
 * repo, `effectiveContext` itself failing) degrades to `{bodies: [],
 * specsRead: [], details: []}` rather than failing the run, matching every
 * other builder in this file.
 */
export async function resolveProjectContext(
  container: Container,
  agentId: string,
  repoId: string | undefined,
  log: StepLog,
): Promise<ResolvedProjectContext> {
  const empty: ResolvedProjectContext = { bodies: [], specsRead: [], details: [] };

  try {
    const effective = await container.projectContext.effectiveContext(agentId);
    if (effective.documents.length === 0) return empty;

    const charCap = container.config.projectContextDocCharCap;

    // Same input, same call, as `ProjectContextService.effectiveContext`'s
    // own `planBudget` call — see this function's doc comment above for why
    // that identity is load-bearing, not incidental.
    const { injected } = planBudget(effective.documents, container.config.projectContextBudgetTokens);
    const budgetInjected = new Set(injected);

    const bodies: string[] = [];
    const specsRead: string[] = [];
    const details: ProjectContextTraceItem[] = [];

    // Resolved lazily, at most once — every document that reaches the
    // filesystem-read step below shares `repoId` by construction (the
    // wrong_repo check runs first and `continue`s otherwise).
    let realRoot: string | null | undefined;

    for (const doc of effective.documents) {
      if (repoId === undefined || doc.repo_id !== repoId) {
        details.push({ path: doc.path, tokens: doc.tokens, outcome: 'wrong_repo' });
        continue;
      }

      if (!budgetInjected.has(doc)) {
        details.push({ path: doc.path, tokens: doc.tokens, outcome: 'dropped_over_budget' });
        continue;
      }

      if (realRoot === undefined) {
        const repo: RepoRow | undefined = await container.reviewRepo.getRepo(repoId);
        realRoot =
          repo && repo.clonePath !== null ? await realpath(repo.clonePath).catch(() => null) : null;
      }
      if (realRoot === null) {
        details.push({ path: doc.path, tokens: doc.tokens, outcome: 'missing' });
        continue;
      }

      const buf = await readClonePath(realRoot, doc.path);
      if (buf === null) {
        details.push({ path: doc.path, tokens: doc.tokens, outcome: 'missing' });
        continue;
      }

      const currentHash = sha256Hex(buf);
      const owner =
        doc.source === 'skill' && doc.skill_id !== undefined
          ? { skillId: doc.skill_id }
          : { agentId };
      const attachment = await container.projectContextRepo.getAttachment(owner, doc.repo_id, doc.path);
      const changed = attachment !== undefined && attachment.attachedHash !== currentHash;

      let text = buf.toString('utf8');
      let truncated = false;
      if (text.length > charCap) {
        text = text.slice(0, charCap);
        truncated = true;
      }

      bodies.push(text);
      specsRead.push(doc.path);
      const outcome = changed ? 'changed_unconfirmed' : truncated ? 'truncated' : 'injected';
      details.push({
        path: doc.path,
        tokens: doc.tokens,
        outcome,
        ...(truncated ? { truncated: true } : {}),
        ...(changed ? { changed: true } : {}),
      });
    }

    log.info(
      `project context: ${bodies.length}/${effective.documents.length} document(s) injected`,
    );

    return { bodies, specsRead, details };
  } catch (err) {
    // Never let a project-context failure fail the run — degrade to no
    // context at all, same contract as every other builder in this file.
    log.info(`project context: resolution failed — ${(err as Error).message}`);
    return empty;
  }
}
