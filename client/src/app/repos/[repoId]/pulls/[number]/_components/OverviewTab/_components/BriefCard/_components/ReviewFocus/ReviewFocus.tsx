/* ReviewFocus — the brief's "read these first" list: server-picked file:line
   pointers a reviewer should open before anything else. Purely presentational
   — it owns no data fetching and no navigation; the caller decides what
   "opening a file:line" means (switching to Files changed + scrolling to the
   anchor).

   Severity reuses the same `SEV` vocabulary and `Badge dot` rendering as
   FindingCard/FindingsPanel elsewhere in this tab, so a reviewer sees one
   severity language across the PR page rather than a parallel one invented
   here. The dot is never the only signal: `Badge` renders it next to the
   severity's text label. */
"use client";

import { useTranslations } from "next-intl";
import { SectionLabel, Badge, SEV } from "@devdigest/ui";
import type { ReviewFocusEntry } from "@devdigest/shared";
import { s } from "./styles";

export interface ReviewFocusProps {
  entries: ReviewFocusEntry[];
  onOpenFileLine: (path: string, line: number) => void;
}

export function ReviewFocus({ entries, onOpenFileLine }: ReviewFocusProps) {
  const t = useTranslations("brief");

  // Server-side truncation (never more than a handful of entries) already
  // decided what's worth surfacing — there is no affordance to reveal
  // additional entries, and an empty list means the section (heading
  // included) does not render at all (AC-25).
  if (entries.length === 0) return null;

  return (
    <section style={s.section}>
      <SectionLabel icon="Eye">{t("reviewFocus.title")}</SectionLabel>
      <ul style={s.list}>
        {entries.map((entry, i) => {
          const sev = SEV[entry.severity];
          return (
            <li key={`${entry.file}:${entry.line}:${i}`} style={s.item}>
              <button
                type="button"
                style={s.row}
                aria-label={t("reviewFocus.open", { file: entry.file, line: entry.line })}
                onClick={() => onOpenFileLine(entry.file, entry.line)}
              >
                <Badge dot bg="transparent" color={sev.c}>
                  {sev.label}
                </Badge>
                <span className="mono" style={s.location}>
                  {entry.file}:{entry.line}
                </span>
                <span style={s.reason}>{entry.reason}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
