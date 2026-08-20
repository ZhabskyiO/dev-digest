import type { CSSProperties } from "react";
import { CONTENT_MAX_WIDTH } from "./constants";

/** Co-located styles for ProjectContextView — a two-pane browse layout
 *  (document list + read-only preview), same page-padding convention as the
 *  sibling `conventions` page. */
export const s = {
  content: {
    maxWidth: CONTENT_MAX_WIDTH,
    width: "100%",
    padding: "32px 24px",
  } satisfies CSSProperties,
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 20,
  } satisfies CSSProperties,
  pageTitle: { fontSize: 22, fontWeight: 700, marginBottom: 4 } satisfies CSSProperties,
  repoName: { color: "var(--accent-text)" } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  } satisfies CSSProperties,
  notice: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    marginBottom: 16,
  } satisfies CSSProperties,
  loadingStack: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  layout: {
    display: "grid",
    gridTemplateColumns: "340px 1fr",
    gap: 20,
    alignItems: "start",
  } satisfies CSSProperties,
  listPane: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    minWidth: 0,
  } satisfies CSSProperties,
  groups: {
    display: "flex",
    flexDirection: "column",
    gap: 18,
  } satisfies CSSProperties,
  groupHeading: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  groupList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } satisfies CSSProperties,
  row: (selected: boolean) =>
    ({
      display: "flex",
      flexDirection: "column",
      gap: 4,
      width: "100%",
      padding: "8px 10px",
      borderRadius: 8,
      border: "1px solid transparent",
      background: selected ? "var(--bg-hover)" : "transparent",
      borderColor: selected ? "var(--border)" : "transparent",
    }) satisfies CSSProperties,
  // The row's clickable "select for preview" surface. Split out from `row`
  // (a plain div) so drift-owner chips can sit alongside it as siblings
  // rather than nested inside a <button> (invalid HTML, breaks click
  // semantics — a document can have several owner chips, each its own
  // button).
  rowSelectBtn: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    alignItems: "flex-start",
    width: "100%",
    textAlign: "left",
    padding: 0,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    font: "inherit",
    color: "inherit",
  } satisfies CSSProperties,
  rowTop: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
  } satisfies CSSProperties,
  rowName: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  rowDir: { fontSize: 11, color: "var(--text-muted)" } satisfies CSSProperties,
  rowMeta: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  previewPane: {
    minWidth: 0,
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    minHeight: 320,
    display: "flex",
    flexDirection: "column",
  } satisfies CSSProperties,
  // Which agent(s)/skill(s) a document has drifted for (AC-36), each name a
  // separate clickable chip that opens that owner's drift detail (AC-38).
  driftOwners: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  driftOwnersLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  driftOwnerBtn: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 999,
    padding: "2px 8px",
    cursor: "pointer",
    font: "inherit",
  } satisfies CSSProperties,
  driftPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 16,
  } satisfies CSSProperties,
  driftPanelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  } satisfies CSSProperties,
  driftPanelTitle: { fontSize: 14, fontWeight: 700 } satisfies CSSProperties,
} as const;
