/**
 * Mode registry — what `--mode` can be, and how each one is collected.
 *
 * `working` is the only mode implemented today. `staged` and `branch` are
 * listed with `collect: null` on purpose: the vocabulary is fixed now (here,
 * and in the `LocalReviewMode` contract the server validates against), so
 * adding one later is a collector function and nothing else — no new flag, no
 * new endpoint, no change to the CLI's control flow or exit contract.
 *
 * `--mode staged` therefore fails as "not implemented yet" with the modes that
 * do work, never as "unknown mode".
 */

import type { LocalReviewMode } from '@devdigest/shared';
import { collectWorkingTreeDiff, type CollectedDiff } from './git.js';

export type ModeCollector = (
  root: string,
  opts: { untracked: boolean },
) => Promise<CollectedDiff>;

export type ModeSpec = {
  /** One line for `--help`. */
  summary: string;
  /** How to build the diff, or null while the mode is unimplemented. */
  collect: ModeCollector | null;
};

export const MODES: Record<LocalReviewMode, ModeSpec> = {
  working: {
    summary: 'working tree vs HEAD — staged + unstaged edits, plus untracked files',
    collect: collectWorkingTreeDiff,
  },
  staged: {
    summary: 'index vs HEAD — only what is staged (not implemented yet)',
    collect: null,
  },
  branch: {
    summary: 'branch vs its merge base — the whole branch (not implemented yet)',
    collect: null,
  },
};

export const MODE_NAMES = Object.keys(MODES) as LocalReviewMode[];

export function isMode(value: string): value is LocalReviewMode {
  return (MODE_NAMES as string[]).includes(value);
}

export const IMPLEMENTED_MODES = MODE_NAMES.filter((m) => MODES[m].collect !== null);
