import type { OnboardingSection } from "@devdigest/shared";
import { SECTION_ORDER } from "./constants";

/**
 * The repo's "short name" for the header's visually distinguished span
 * (AC-35) — the part of `owner/repo` after the last "/", falling back to the
 * full string when there's no slash (defensive; every real `full_name` has
 * one, but the repo may still be loading).
 */
export function repoShortName(fullName: string | null | undefined): string {
  if (!fullName) return "";
  const idx = fullName.lastIndexOf("/");
  return idx === -1 ? fullName : fullName.slice(idx + 1);
}

/**
 * The tour's sections, reordered defensively to AC-1's fixed order — every
 * kind in `SECTION_ORDER` that is present in `sections`, in that order. The
 * server enforces the same order when it stores a tour, but nothing here
 * trusts storage order for what actually renders or for the on-this-page
 * list built from it (AC-36).
 */
export function orderedSections(sections: OnboardingSection[]): OnboardingSection[] {
  const byKind = new Map(sections.map((section) => [section.kind, section]));
  const ordered: OnboardingSection[] = [];
  for (const kind of SECTION_ORDER) {
    const section = byKind.get(kind);
    if (section) ordered.push(section);
  }
  return ordered;
}

/** Locale-formatted `generated_at` for the subtitle — never a raw ISO string. */
export function formatGeneratedAt(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * The page's own shareable URL (AC-40): its own origin + pathname, plus an
 * anchor for whichever section is currently in view. Pure string-building —
 * no request is made, no token or record is created.
 */
export function buildShareUrl(origin: string, pathname: string, activeKind: string | null): string {
  const base = `${origin}${pathname}`;
  return activeKind ? `${base}#${activeKind}` : base;
}
