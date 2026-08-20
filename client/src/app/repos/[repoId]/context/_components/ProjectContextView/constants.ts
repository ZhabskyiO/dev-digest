import type { ProjectContextDocType } from "@devdigest/shared";

/** Type-label accent — same palette `AttachmentList` draws from
 *  (`components/project-context/AttachmentList/AttachmentList.tsx`), kept as
 *  a local copy since that map isn't exported. */
export const TYPE_COLOR: Record<ProjectContextDocType, string> = {
  specs: "var(--accent-text)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

/**
 * Display order for the type groups — matches the AC-7 type derivation order
 * (specs, docs, insights) rather than alphabetical, so the section that most
 * reviews lean on (specs) always renders first.
 */
export const DOC_TYPE_ORDER: readonly ProjectContextDocType[] = ["specs", "docs", "insights"] as const;

/**
 * Same reading-column cap the sibling `conventions` page uses
 * (`../conventions/_components/ConventionsView/constants.ts`) — kept local
 * rather than promoted to a shared constant because this is the only other
 * consumer so far.
 */
export const CONTENT_MAX_WIDTH = 1240;

export const SKELETON_ROWS = 6;
