/* CriticalPathsCard — ordered {path, why} rows (rank order is the render
   order, AC-16/AC-17), each with a per-row Open control targeting the
   repository's hosting-provider blob URL at the tour's recorded indexed
   revision, falling back to the default branch when none was recorded
   (AC-39). Opens in a new context that cannot script the opener
   (rel="noopener noreferrer") — same construction findings already use. */
"use client";

import { useTranslations } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import { githubBlobUrl } from "@/lib/github-urls";
import { SectionCard } from "../SectionCard";
import { s } from "./styles";

type CriticalPathsSection = Extract<OnboardingSection, { kind: "critical_paths" }>;

export function CriticalPathsCard({
  section,
  repoFullName,
  revision,
  defaultBranch,
}: {
  section: CriticalPathsSection;
  /** `owner/repo` — required to build a github.com blob link. */
  repoFullName: string | null | undefined;
  /** The tour's recorded `indexed_revision`. */
  revision: string | null | undefined;
  /** Used when no revision was recorded (AC-39). */
  defaultBranch: string | null | undefined;
}) {
  const t = useTranslations("onboarding");
  const isEmpty = section.items.length === 0;
  const ref = revision ?? defaultBranch ?? null;

  return (
    <SectionCard
      kind="critical_paths"
      icon="Activity"
      isEmpty={isEmpty}
      emptyReasonCode={section.empty_reason}
    >
      <ul style={s.list}>
        {section.items.map((item, i) => {
          const href = repoFullName && ref ? githubBlobUrl(repoFullName, ref, item.path) : undefined;
          return (
            <li key={`${item.path}-${i}`} style={s.row}>
              <div style={s.rowMain}>
                <span className="mono" style={s.path}>
                  {item.path}
                </span>
                <span style={s.why}>{item.why}</span>
              </div>
              {href && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t("openFile", { path: item.path })}
                  style={s.openBtn}
                >
                  {t("open")}
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
