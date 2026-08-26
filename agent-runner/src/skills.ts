import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RunnerError } from './errors.js';

/**
 * Loads the checked-in `.devdigest/skills/<slug>.md` bodies referenced by the
 * manifest's `skills` slugs, in order. These are RESOLVED skill bodies (not
 * slugs) — `reviewPullRequest` (reviewer-core) takes strings, exactly like the
 * studio resolves slugs to DB rows before calling the same engine (AC-36
 * parity: both callers hand the engine already-resolved bodies).
 *
 * `manifest.skills` is untrusted, on-disk content (see `manifest.ts`) — the
 * shared `AgentManifest` Zod schema only constrains it to `string[]`, with no
 * format check. A slug is used directly to build a filesystem path, so a slug
 * like `../../../../etc/passwd` must be rejected BEFORE `path.join` — resolved
 * skill bodies are also injected into the prompt as trusted "Skills / rules"
 * text (`reviewer-core/src/prompt.ts` never wraps them in `wrapUntrusted`,
 * unlike the diff/PR description), so an escape here is both a path-traversal
 * read of an arbitrary file AND a route for its contents to reach the LLM
 * (and potentially the posted review) as if they were trusted rules.
 */
const SAFE_SLUG = /^[a-zA-Z0-9_-]+$/;

export function loadSkillBodies(
  devdigestDir: string,
  slugs: readonly string[],
  readFile: typeof readFileSync = readFileSync,
): string[] {
  const skillsDir = path.resolve(devdigestDir, 'skills');
  return slugs.map((slug) => {
    if (!SAFE_SLUG.test(slug)) {
      throw new RunnerError(
        `Invalid skill slug '${slug}': must match ${SAFE_SLUG} (no path separators or traversal)`,
      );
    }
    const skillPath = path.join(skillsDir, `${slug}.md`);
    // Defense in depth: SAFE_SLUG above already rejects '/' and '..', but
    // re-verify the resolved path never leaves skillsDir before ever reading it.
    if (path.resolve(skillPath) !== skillPath || !skillPath.startsWith(skillsDir + path.sep)) {
      throw new RunnerError(`Resolved skill path escapes the skills directory: ${skillPath}`);
    }
    try {
      return readFile(skillPath, 'utf8');
    } catch (err) {
      throw new RunnerError(
        `Skill file for slug '${slug}' not found at ${skillPath}: ${(err as Error).message}`,
      );
    }
  });
}
