/* SkillCard — name, type badge, source badge, enabled Toggle, and a "needs
   vetting" indicator (source !== 'manual' && !enabled). Close template:
   AgentCard.tsx. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Skill, SkillStatsSummary } from "@devdigest/shared";
import { needsVetting, typeColor } from "./helpers";
import { s } from "./styles";

export function SkillCard({
  skill,
  active,
  stats,
  onClick,
  onToggle,
}: {
  skill: Skill;
  active?: boolean;
  /** Summary row from GET /skills/stats; omitted while the list is loading. */
  stats?: SkillStatsSummary;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("skills");
  const color = typeColor(skill.type);
  const vetting = needsVetting(skill);
  return (
    <div onClick={onClick} style={s.card(!!active, skill.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Sparkles size={15} />
        </div>
        <span style={s.name}>{skill.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={skill.enabled} onChange={onToggle} size={14} />
          </div>
        )}
      </div>
      <div style={s.description}>{skill.description}</div>
      <div style={s.metaRow}>
        <span className="mono" style={s.typeChip(color)}>
          {t(`listItem.type.${skill.type}`)}
        </span>
        <Badge color="var(--text-secondary)">{t(`listItem.source.${skill.source}`)}</Badge>
        {vetting && (
          <span title={t("listItem.vettingTitle")}>
            <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
              {t("listItem.needsVetting")}
            </Badge>
          </span>
        )}
      </div>
      {stats && (
        <div style={s.statsRow}>
          <span>{t("listItem.agentCount", { count: stats.agents_using })}</span>
          {stats.pull_pct !== null && (
            <span className="tnum">{t("listItem.pull", { pct: stats.pull_pct })}</span>
          )}
          {stats.accept_rate !== null && (
            <span className="tnum" style={s.accept(stats.accept_rate)}>
              {t("listItem.accept", { pct: stats.accept_rate })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
