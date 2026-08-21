/* project-context — shared presentational components for the Project Context
   feature (specs/2026-08-18-project-context.md), reused by the Project
   Context page, the agent Context tab, and the skill's "Project context to
   use" section. Take props only; hooks are wired by the screen tasks. */
export { AttachmentList, type AttachmentListItem } from "./AttachmentList";
export { DocumentFilter } from "./DocumentFilter";
export { TokenBudgetBar } from "./TokenBudgetBar";
export { DriftBadge } from "./DriftBadge";
export { DocumentPreview } from "./DocumentPreview";
export { DriftCompare, diffLines, type DiffLine, type DiffLineType } from "./DriftCompare";
