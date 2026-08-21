/* FirstTasksCard — {title, target, complexity} cards. The badge's text reads
   the full "Low/Medium/High complexity" string from the catalogue (AC-46),
   so the level is conveyed even in greyscale, not by colour alone. */
"use client";

import { useTranslations } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import { SectionCard } from "../SectionCard";
import { s } from "./styles";

type FirstTasksSection = Extract<OnboardingSection, { kind: "first_tasks" }>;

export function FirstTasksCard({ section }: { section: FirstTasksSection }) {
  const t = useTranslations("onboarding");
  const isEmpty = section.items.length === 0;
  return (
    <SectionCard kind="first_tasks" icon="Target" isEmpty={isEmpty} emptyReasonCode={section.empty_reason}>
      <div style={s.grid}>
        {section.items.map((item, i) => (
          <div key={`${item.title}-${i}`} style={s.card}>
            <div style={s.title}>{item.title}</div>
            <div className="mono" style={s.target}>
              {item.target}
            </div>
            <span style={s.badge(item.complexity)}>{t(`complexity.${item.complexity}`)}</span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
