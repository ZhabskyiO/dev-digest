/* DisagreementBlock — "Where agents disagree". One row per cross-agent
   location group; a "Show only conflicts" toggle hides groups where every
   participating agent landed on the same verdict (AC-29). Renders identically
   in both Columns and Tabs mode (T18 mounts it once, shared). */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Icon, SeverityBadge } from "@devdigest/ui";
import type { Conflict, ConflictTake } from "@devdigest/shared";
import { filterConflicts } from "./helpers";
import { s } from "./styles";

type T = ReturnType<typeof useTranslations>;

export function DisagreementBlock({ conflicts }: { conflicts: Conflict[] }) {
  const t = useTranslations("runs");
  const [onlyConflicts, setOnlyConflicts] = useState(false);
  const displayed = filterConflicts(conflicts, onlyConflicts);

  return (
    <section style={s.section} aria-label={t("page.disagree.title")}>
      <div style={s.header}>
        <h3 style={s.title}>{t("page.disagree.title")}</h3>
        <button
          type="button"
          aria-pressed={onlyConflicts}
          onClick={() => setOnlyConflicts((prev) => !prev)}
          style={s.toggle(onlyConflicts)}
        >
          {t("page.disagree.onlyConflicts")}
        </button>
      </div>

      {displayed.length === 0 ? (
        <div style={s.empty}>
          <div style={s.emptyTitle}>{t("page.disagree.emptyTitle")}</div>
          <div style={s.emptyBody}>{t("page.disagree.emptyBody")}</div>
        </div>
      ) : (
        <div style={s.groups}>
          {displayed.map((group) => (
            <DisagreementGroup
              key={`${group.file}:${group.start_line}-${group.end_line}`}
              group={group}
              t={t}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DisagreementGroup({ group, t }: { group: Conflict; t: T }) {
  return (
    <div style={s.group}>
      <div style={s.groupHeader}>
        <span className="mono" style={s.file}>
          {group.file}
        </span>
        <span style={s.range}>
          {t("page.disagree.rangeLabel", { start: group.start_line, end: group.end_line })}
        </span>
        {/* Agent-authored short label — rendered as an inert text node, never
            markup (AC-48). */}
        <span style={s.label}>{group.title}</span>
      </div>
      <div style={s.takes}>
        {group.takes.map((take) => (
          <TakeCell key={take.agent_id} take={take} t={t} />
        ))}
      </div>
    </div>
  );
}

function TakeCell({ take, t }: { take: ConflictTake; t: T }) {
  return (
    <div style={s.cell}>
      <span style={s.agentName}>{take.agent_name}</span>
      {take.verdict === "ignored" ? (
        <span style={s.didNotFlag}>
          <Icon.EyeOff size={12.5} aria-hidden />
          {t("page.disagree.didNotFlag")}
        </span>
      ) : (
        <SeverityBadge severity={take.verdict} />
      )}
      {take.note && <span style={s.note}>{take.note}</span>}
    </div>
  );
}
