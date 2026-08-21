import type { ProjectContextDocType, ProjectContextDocument } from "@devdigest/shared";

/** Narrows `documents` to those whose path contains `query` (case-insensitive),
 *  never mutating the checked/selected state of anything else (AC-18's
 *  narrowing rule, applied here to a plain browse list). */
export function filterDocuments(documents: ProjectContextDocument[], query: string): ProjectContextDocument[] {
  const q = query.trim().toLowerCase();
  if (!q) return documents;
  return documents.filter((d) => d.path.toLowerCase().includes(q));
}

/** Groups documents by their AC-7 `type`, preserving `DOC_TYPE_ORDER` even
 *  when a group is empty (the caller decides whether to render an empty
 *  group's header). */
export function groupByType(
  documents: ProjectContextDocument[]
): Record<ProjectContextDocType, ProjectContextDocument[]> {
  const groups: Record<ProjectContextDocType, ProjectContextDocument[]> = {
    specs: [],
    docs: [],
    insights: [],
  };
  for (const doc of documents) {
    groups[doc.type].push(doc);
  }
  return groups;
}

/** Splits a clone-relative path into its trailing filename and leading
 *  directory (empty for a root-level file) — same convention as
 *  `components/project-context/AttachmentList`'s row label. */
export function splitPath(path: string): { name: string; dir: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { name: path, dir: "" };
  return { name: path.slice(idx + 1), dir: path.slice(0, idx + 1) };
}

/** Picks the `page.size.*` translation key + the number to interpolate for a
 *  byte count — bytes under 1 KiB render as `"{n} B"`, everything else as a
 *  one-decimal `"{n} KB"`. Returning the key rather than a formatted string
 *  keeps the unit itself translated through next-intl. */
export function formatSize(bytes: number): { key: "page.size.bytes" | "page.size.kilobytes"; count: number } {
  if (bytes < 1024) return { key: "page.size.bytes", count: bytes };
  return { key: "page.size.kilobytes", count: Math.round((bytes / 1024) * 10) / 10 };
}

/** Joins a list of configured root/filename strings into human prose —
 *  `["specs/", "docs/", "insights/"]` becomes e.g. `"specs/, docs/, and
 *  insights/"` in English — via `Intl.ListFormat` so the conjunction itself
 *  is locale-correct rather than a hardcoded English `" and "`, while still
 *  staying driven entirely by whatever the API returned (never a hardcoded
 *  root list). `locale` must be sourced from next-intl's `useLocale()` at
 *  the call site, not hardcoded. */
export function joinList(items: string[], locale: string): string {
  if (items.length === 0) return "";
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
}
