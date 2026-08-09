/* diff-viewer — unified-diff viewer with optional inline GitHub comments and
   optional review-finding annotations.
   Public surface: the DiffViewer component, the FileCard it is built from
   (Smart Diff composes those directly), the DiffCommentApi contract, and the
   annotation helpers that map findings onto rendered lines. */
export { DiffViewer } from "./DiffViewer";
export { FileCard } from "./FileCard";
export type { DiffCommentApi } from "./comments";
export { annotationsFor, diffLineAnchorId } from "./annotations";
export type { FileAnnotations, LineFinding } from "./annotations";
