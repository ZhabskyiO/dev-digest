/* RoutesAndApisCard — typed route entries (never a prose inventory, AC-49)
   rendered as two labelled surfaces: frontend routes (flat) and API
   endpoints (grouped by area within the surface). A surface with no entries
   is omitted entirely rather than shown as an empty heading (AC-50).
   Diagram is optional (this is one of the two diagram-bearing kinds, AC-14),
   and the `facts_unavailable` / `items_capped` notices render as header
   notices independent of the empty-reason line (AC-52, Rec-8). */
"use client";

import { useTranslations } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import { SectionCard } from "../SectionCard";
import { groupByArea } from "./helpers";
import { s } from "./styles";

type RoutesSection = Extract<OnboardingSection, { kind: "routes_and_apis" }>;

export function RoutesAndApisCard({ section }: { section: RoutesSection }) {
  const t = useTranslations("onboarding");
  const frontend = section.items.filter((item) => item.surface === "frontend");
  const api = section.items.filter((item) => item.surface === "api");
  const apiGroups = groupByArea(api);
  const isEmpty = section.items.length === 0;
  // Prefer the server's own reason; when the whole section came back empty
  // AND the index carried no endpoint facts, that is the more specific and
  // more useful explanation to show.
  const emptyReasonCode =
    section.empty_reason ?? (isEmpty && section.facts_unavailable ? "facts_unavailable" : null);

  const notices = (
    <>
      {section.facts_unavailable && !isEmpty && (
        <p style={s.notice}>{t("emptyReason.facts_unavailable")}</p>
      )}
      {section.items_capped && <p style={s.notice}>{t("routes.itemsCapped")}</p>}
    </>
  );

  return (
    <SectionCard
      kind="routes_and_apis"
      icon="Boxes"
      isEmpty={isEmpty}
      emptyReasonCode={emptyReasonCode}
      headerExtra={notices}
    >
      {section.diagram && <MermaidDiagram chart={section.diagram} />}
      {frontend.length > 0 && (
        <div>
          <h3 style={s.surfaceHeading}>{t("routes.frontend")}</h3>
          <ul style={s.list}>
            {frontend.map((item, i) => (
              <li key={`${item.route}-${i}`} style={s.row}>
                <span className="mono" style={s.route}>
                  {item.route}
                </span>
                {item.note && <span style={s.note}>{item.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {api.length > 0 && (
        <div>
          <h3 style={s.surfaceHeading}>{t("routes.api")}</h3>
          {apiGroups.map(([group, items]) => (
            <div key={group} style={s.group}>
              <h4 style={s.groupHeading}>{group}</h4>
              <ul style={s.list}>
                {items.map((item, i) => (
                  <li key={`${item.route}-${i}`} style={s.row}>
                    {item.method && (
                      <span className="mono" style={s.method}>
                        {item.method}
                      </span>
                    )}
                    <span className="mono" style={s.route}>
                      {item.route}
                    </span>
                    {item.note && <span style={s.note}>{item.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
