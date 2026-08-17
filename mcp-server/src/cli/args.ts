/**
 * Argument parsing + the help text.
 *
 * Pure: takes argv, returns a discriminated union. It never reads the
 * environment, touches git, or exits — `index.ts` owns all of that, so the
 * parser stays trivially testable.
 */

import type { CiFailOn, LocalReviewMode } from '@devdigest/shared';
import { MODES, MODE_NAMES, IMPLEMENTED_MODES, isMode } from './modes.js';

export const FAIL_ON_VALUES: CiFailOn[] = ['never', 'critical', 'warning', 'any'];

/** Default wait for the review call — an LLM pass over a big diff is slow. */
export const DEFAULT_TIMEOUT_MS = 180_000;

export type ReviewOptions = {
  mode: LocalReviewMode;
  /** Agent id or name; undefined → let the server pick its single enabled agent. */
  agent?: string;
  /** `owner/name`; undefined → derived from `origin`, then dropped if unknown. */
  repo?: string;
  /** Explicitly disable repo lookup even if `origin` would resolve. */
  noRepo: boolean;
  failOn?: CiFailOn;
  untracked: boolean;
  json: boolean;
  /** Collect and print the diff, then stop — no API call, no model spend. */
  dryRun: boolean;
  apiUrl?: string;
  timeoutMs: number;
};

export type Parsed =
  | { kind: 'help' }
  | { kind: 'version' }
  | { kind: 'review'; opts: ReviewOptions }
  | { kind: 'usage-error'; message: string };

export function parseArgs(argv: string[]): Parsed {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    return { kind: 'help' };
  }
  if (command === '--version' || command === '-v') return { kind: 'version' };
  if (command !== 'review') {
    return { kind: 'usage-error', message: `Unknown command '${command}'. The only command is 'review'.` };
  }

  const opts: ReviewOptions = {
    mode: 'working',
    noRepo: false,
    untracked: true,
    json: false,
    dryRun: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    // `--flag=value` and `--flag value` are both accepted.
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) return inlineValue;
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('-')) return undefined;
      i++;
      return next;
    };

    switch (flag) {
      case '--help':
      case '-h':
        return { kind: 'help' };

      case '--mode': {
        const value = takeValue();
        if (value === undefined) return missingValue(flag);
        if (!isMode(value)) {
          return {
            kind: 'usage-error',
            message: `Unknown --mode '${value}'. Known modes: ${MODE_NAMES.join(', ')}.`,
          };
        }
        if (MODES[value].collect === null) {
          return {
            kind: 'usage-error',
            message: `--mode ${value} is not implemented yet. Implemented: ${IMPLEMENTED_MODES.join(', ')}.`,
          };
        }
        opts.mode = value;
        break;
      }

      case '--agent': {
        const value = takeValue();
        if (value === undefined) return missingValue(flag);
        opts.agent = value;
        break;
      }

      case '--repo': {
        const value = takeValue();
        if (value === undefined) return missingValue(flag);
        opts.repo = value;
        break;
      }

      case '--no-repo':
        opts.noRepo = true;
        break;

      case '--fail-on': {
        const value = takeValue();
        if (value === undefined) return missingValue(flag);
        if (!FAIL_ON_VALUES.includes(value as CiFailOn)) {
          return {
            kind: 'usage-error',
            message: `Unknown --fail-on '${value}'. Expected one of: ${FAIL_ON_VALUES.join(', ')}.`,
          };
        }
        opts.failOn = value as CiFailOn;
        break;
      }

      case '--no-untracked':
        opts.untracked = false;
        break;

      case '--json':
        opts.json = true;
        break;

      case '--dry-run':
        opts.dryRun = true;
        break;

      case '--api-url': {
        const value = takeValue();
        if (value === undefined) return missingValue(flag);
        opts.apiUrl = value.replace(/\/+$/, '');
        break;
      }

      case '--timeout': {
        const value = takeValue();
        if (value === undefined) return missingValue(flag);
        const seconds = Number(value);
        if (!Number.isFinite(seconds) || seconds <= 0) {
          return { kind: 'usage-error', message: `--timeout expects seconds, got '${value}'.` };
        }
        opts.timeoutMs = Math.round(seconds * 1000);
        break;
      }

      default:
        return { kind: 'usage-error', message: `Unknown option '${flag}'. Run 'devdigest review --help'.` };
    }
  }

  return { kind: 'review', opts };
}

function missingValue(flag: string): Parsed {
  return { kind: 'usage-error', message: `${flag} expects a value.` };
}

export function helpText(): string {
  const modeLines = MODE_NAMES.map((m) => `    ${m.padEnd(8)} ${MODES[m].summary}`).join('\n');
  return `devdigest — local-first PR review, before the PR exists

USAGE
  devdigest review [--mode working] [options]

WHAT IT DOES
  Reviews the changes in your working copy with the SAME reviewer agent, prompt,
  skills, and citation-grounding gate the studio runs on a pull request — just
  earlier, before you commit or push. The diff is sent to the DevDigest API
  (POST /reviews/local); nothing about the run is persisted there.

MODES (--mode, default: working)
${modeLines}

  'working' collects 'git diff HEAD', which covers staged AND unstaged edits to
  tracked files. Untracked files are invisible to that command, so each one is
  additionally diffed against /dev/null (.gitignore respected); pass
  --no-untracked to leave them out. Binary and >256 KB untracked files are
  skipped and reported. File DELETIONS are not reviewed: they have no new-side
  lines, so no finding could be grounded on them.

OPTIONS
  --mode <mode>       Which local change-set to review (default: working).
  --agent <id|name>   Reviewer agent. Default: the workspace's enabled agent,
                      when exactly one is enabled.
  --repo <owner/name> Imported repo to pull context from (repo map, callers of
                      changed symbols). Default: guessed from 'origin'.
  --no-repo           Do not send a repo — review the diff with no repo context.
  --fail-on <gate>    Override what counts as blocking for this run:
                      ${FAIL_ON_VALUES.join(' | ')}. Default: the agent's own gate.
  --no-untracked      Exclude untracked files from the diff.
  --json              Print the raw result as JSON instead of a report.
  --dry-run           Collect and print the diff; do not review (no model spend).
  --api-url <url>     DevDigest API base (default: $DEVDIGEST_API_URL or
                      http://localhost:3001).
  --timeout <seconds> How long to wait for the review (default: ${DEFAULT_TIMEOUT_MS / 1000}).
  -h, --help          Show this help.
  -v, --version       Print the version.

EXIT CODES
  0  Review ran; nothing blocking. A clean working tree also exits 0.
  1  Review ran; blocking findings (>= the gate). The only "your code has a
     problem" code.
  2  Usage error: unknown flag, unknown or unimplemented --mode, bad --fail-on.
  3  Review could NOT run: not a git repo, git failed, API unreachable or
     errored, no usable agent, timeout. Says nothing about your code.

EXAMPLES
  devdigest review --mode working
  devdigest review --agent "Quality Reviewer" --fail-on warning
  devdigest review --dry-run --no-untracked
  devdigest review --json > review.json

REQUIREMENTS
  The DevDigest API must be running (./scripts/dev.sh from the repo root).
`;
}
