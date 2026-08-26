/**
 * The line-diff helpers moved to `src/lib/line-diff.ts` when the agent
 * editor's VersionsTab started needing the same diff. This file is a thin
 * re-export shim so existing `./helpers` importers keep working.
 */
export {
  collapseUnchanged,
  diffLines,
  isIdentical,
  type DiffKind,
  type DiffRow,
} from "../../../../../../lib/line-diff";
