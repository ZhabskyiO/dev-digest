/**
 * `devdigest` CLI — composition root for the command-line entry point.
 *
 * The pre-push half of DevDigest: same reviewer, same agent, same grounding
 * gate as a PR review in the studio, run against the working copy before a
 * commit or push exists. It owns exactly three things — argv, git, and the
 * process exit code. Collection lives in `git.ts`, the review call in
 * `core/local-review.ts`, and the review itself on the server.
 *
 * Unlike `src/index.ts` (the MCP server, where stdout is the JSON-RPC channel
 * and every log must go to stderr), this process talks to a human: the report
 * goes to stdout and diagnostics to stderr, so `devdigest review --json | jq`
 * works.
 */

import { parseArgs, helpText, type ReviewOptions } from './args.js';
import { EXIT, type ExitCode } from './exit.js';
import { MODES } from './modes.js';
import { GitError, repoRoot, describeHead, originFullName, type CollectedDiff } from './git.js';
import { renderResult, renderDryRun } from './render.js';
import { createClient } from '../http/client.js';
import { runLocalReview } from '../core/local-review.js';
import { resolveAgentId } from '../core/resolve.js';

const VERSION = '0.1.0';

async function main(argv: string[]): Promise<ExitCode> {
  const parsed = parseArgs(argv);

  switch (parsed.kind) {
    case 'help':
      process.stdout.write(helpText());
      return EXIT.OK;
    case 'version':
      process.stdout.write(`${VERSION}\n`);
      return EXIT.OK;
    case 'usage-error':
      process.stderr.write(`${parsed.message}\n\nRun 'devdigest --help'.\n`);
      return EXIT.USAGE;
    case 'review':
      return review(parsed.opts);
  }
}

async function review(opts: ReviewOptions): Promise<ExitCode> {
  const color = opts.json ? false : process.stdout.isTTY === true && !process.env['NO_COLOR'];

  // ---- Collect (git) ------------------------------------------------------
  let root: string;
  let label: string;
  let collected: CollectedDiff;
  try {
    root = await repoRoot(process.cwd());
    label = await describeHead(root);
    const collect = MODES[opts.mode].collect;
    /* c8 ignore next */
    if (!collect) throw new GitError(`Mode '${opts.mode}' has no collector.`); // parseArgs already rejects these
    collected = await collect(root, { untracked: opts.untracked });
  } catch (err) {
    const message = err instanceof GitError ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    return EXIT.UNAVAILABLE;
  }

  if (opts.dryRun) {
    process.stdout.write(
      `${renderDryRun(
        {
          label,
          mode: opts.mode,
          files: collected.files,
          skipped: collected.skipped,
          bytes: Buffer.byteLength(collected.diff),
        },
        { color },
      )}\n`,
    );
    return EXIT.OK;
  }

  // Nothing to review is a PASS, not a failure — a pre-push hook on a clean
  // tree must not block, and must not spend a model call to learn that.
  if (collected.diff.trim().length === 0) {
    const text = `No local changes to review (${opts.mode}, ${label}).`;
    process.stdout.write(opts.json ? `${JSON.stringify({ mode: opts.mode, files: 0, findings: [], blocking: false })}\n` : `${text}\n`);
    for (const s of collected.skipped) process.stderr.write(`skipped ${s.path} — ${s.reason}\n`);
    return EXIT.OK;
  }

  // ---- Review (server) ----------------------------------------------------
  // `config.apiUrl` re-reads the environment on every request (see config.ts),
  // so writing the flag here — after the client module has long been imported —
  // is what makes --api-url take effect.
  if (opts.apiUrl) process.env['DEVDIGEST_API_URL'] = opts.apiUrl;

  const repo = opts.noRepo ? undefined : (opts.repo ?? (await originFullName(root)));

  if (!opts.json) {
    process.stderr.write(
      `Reviewing ${collected.files.length} file(s) from the ${opts.mode} change-set of ${label}…\n`,
    );
  }

  const outcome = await runLocalReview(
    createClient(),
    {
      mode: opts.mode,
      diff: collected.diff,
      ...(opts.agent !== undefined ? { agent: opts.agent } : {}),
      ...(repo !== undefined ? { repo } : {}),
      ...(opts.failOn !== undefined ? { failOn: opts.failOn } : {}),
      label,
    },
    { timeoutMs: opts.timeoutMs },
    { resolveAgentId },
  );

  if (outcome.kind === 'failed') {
    process.stderr.write(`Review could not run: ${outcome.error}\n`);
    return EXIT.UNAVAILABLE;
  }

  // ---- Report -------------------------------------------------------------
  const { result } = outcome;
  process.stdout.write(
    opts.json
      ? `${JSON.stringify({ ...result, skipped: collected.skipped }, null, 2)}\n`
      : `${renderResult(result, { label, skipped: collected.skipped }, { color })}\n`,
  );

  return result.blocking ? EXIT.BLOCKED : EXIT.OK;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    // Anything that reaches here is a bug in the CLI, not a review verdict —
    // so it exits UNAVAILABLE (3), never BLOCKED (1).
    process.stderr.write(`devdigest: unexpected error — ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = EXIT.UNAVAILABLE;
  });
