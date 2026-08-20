/* TableOfContents — the sticky on-this-page rail (AC-36). Always renders
   all six entries in AC-1 order regardless of a section's collapse state or
   emptiness (AC-11, AC-37) — a section card never leaves the tree, so its
   anchor (`id={kind}`, set by SectionCard) always exists to scroll to.
   Activating an entry moves the active marker immediately (rather than
   waiting on the next IntersectionObserver tick) and scrolls its card into
   view; OnboardingTourView owns the actual scrollspy subscription and passes
   the result down as `activeKind`, since both this rail and TourHeader's
   Share link need the same "section currently in view" value (AC-40). */
"use client";

import { useTranslations } from "next-intl";
import type { OnboardingSectionKind } from "@devdigest/shared";
import { s } from "./styles";

export function TableOfContents({
  kinds,
  activeKind,
  onActivate,
}: {
  /** The tour's sections in AC-1 order — every kind present in the tour,
   *  never fewer than six for a fully-generated tour. */
  kinds: OnboardingSectionKind[];
  activeKind: OnboardingSectionKind | null;
  onActivate: (kind: OnboardingSectionKind) => void;
}) {
  const t = useTranslations("onboarding");

  function handleActivate(kind: OnboardingSectionKind) {
    onActivate(kind);
    document.getElementById(kind)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav style={s.nav} aria-label={t("onThisPage")}>
      <div style={s.heading}>{t("onThisPage")}</div>
      <ul style={s.list}>
        {kinds.map((kind) => {
          const active = kind === activeKind;
          return (
            <li key={kind}>
              <button
                type="button"
                onClick={() => handleActivate(kind)}
                aria-current={active ? "true" : undefined}
                style={s.entry(active)}
              >
                {t(`sections.${kind}`)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
