/* SectionCard — the shared frame every onboarding section card renders
   through (docs/plans/onboarding-tour.md T9): the collapse chevron (AC-37),
   the catalogue-derived heading keyed by `kind` (Rec-6 — headings come from
   the message catalogue, never the model's own `title`), the section's
   ON THIS PAGE anchor, and the empty-section reason line (AC-11). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, type IconName } from "@devdigest/ui";
import type { OnboardingSectionKind } from "@devdigest/shared";
import { s } from "./styles";

/**
 * The anchor id is the RAW `kind` value (e.g. `"critical_paths"`) — this is
 * the contract TableOfContents (T11) scrolls to via `#${kind}`. Collapsing
 * only hides the body; the section element itself, and therefore its anchor,
 * stays in the tree regardless of open/empty state, so a TOC entry always
 * has somewhere to scroll to (AC-37, AC-11).
 */
export function SectionCard({
  kind,
  icon,
  isEmpty,
  emptyReasonCode,
  headerExtra,
  children,
}: {
  kind: OnboardingSectionKind;
  icon: IconName;
  isEmpty: boolean;
  /** Machine-readable empty reason (e.g. `insufficient_grounding` |
   *  `facts_unavailable`) driving `emptyReason.<code>`; falls back to the
   *  section's own default `empty.<kind>` line when unset. */
  emptyReasonCode?: string | null;
  /** Notices that render above the body regardless of emptiness — e.g.
   *  routes_and_apis' `facts_unavailable` / `items_capped` markers. */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("onboarding");
  const [open, setOpen] = React.useState(true);
  const heading = t(`sections.${kind}`);
  const bodyId = `onboarding-${kind}-body`;
  const I = Icon[icon];

  return (
    <section id={kind} style={s.card}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={t("collapseSection", { section: heading })}
        style={s.header}
      >
        <span style={s.headingRow}>
          <span style={s.iconWrap}>
            <I size={15} />
          </span>
          <span style={s.heading}>{heading}</span>
        </span>
        <Icon.ChevronDown size={16} style={s.chevron(open)} />
      </button>
      {open && (
        <div id={bodyId} style={s.body}>
          {headerExtra}
          {isEmpty ? (
            <p style={s.emptyLine}>
              {emptyReasonCode ? t(`emptyReason.${emptyReasonCode}`) : t(`empty.${kind}`)}
            </p>
          ) : (
            children
          )}
        </div>
      )}
    </section>
  );
}
