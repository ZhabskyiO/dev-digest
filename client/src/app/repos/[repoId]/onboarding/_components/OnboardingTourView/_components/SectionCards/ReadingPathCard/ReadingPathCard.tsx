/* ReadingPathCard — numbered {path, rationale} sequence. The contract's own
   order IS the render order (deduped, earlier-position-kept, contiguously
   renumbered server-side — AC-20), so the badge is simply the row's index. */
"use client";

import type { OnboardingSection } from "@devdigest/shared";
import { SectionCard } from "../SectionCard";
import { s } from "./styles";

type ReadingPathSection = Extract<OnboardingSection, { kind: "reading_path" }>;

export function ReadingPathCard({ section }: { section: ReadingPathSection }) {
  const isEmpty = section.items.length === 0;
  return (
    <SectionCard kind="reading_path" icon="ListChecks" isEmpty={isEmpty} emptyReasonCode={section.empty_reason}>
      <ol style={s.list}>
        {section.items.map((item, i) => (
          <li key={`${item.path}-${i}`} style={s.row}>
            <span style={s.badge}>{i + 1}</span>
            <div style={s.textCol}>
              <div className="mono" style={s.path}>
                {item.path}
              </div>
              <div style={s.rationale}>{item.rationale}</div>
            </div>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}
