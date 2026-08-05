/* AgentCard — model chip, skills count, enabled toggle. Stats are an A5 mount;
   we render the provider/model + skill count here. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Badge, Toggle } from "@devdigest/ui";
import type { Agent, AgentRunStats } from "@devdigest/shared";
import { useDeleteAgent } from "../../../../lib/hooks/agents";
import { formatCostUsd } from "../../../../lib/format";
import { acceptRateColor, modelColor } from "./helpers";
import { s } from "./styles";

export function AgentCard({
  ag,
  active,
  skillCount,
  stats,
  onClick,
  onToggle,
}: {
  ag: Agent;
  active?: boolean;
  skillCount?: number;
  /** Aggregate run stats (all-time) — omitted while loading, so the row is skipped. */
  stats?: AgentRunStats;
  onClick?: () => void;
  onToggle?: (enabled: boolean) => void;
}) {
  const t = useTranslations("agents");
  const del = useDeleteAgent();
  const color = modelColor(ag.model);
  return (
    <div onClick={onClick} style={s.card(!!active, ag.enabled)}>
      <div style={s.headerRow}>
        <div style={s.iconBox}>
          <Icon.Cpu size={15} />
        </div>
        <span style={s.name}>{ag.name}</span>
        {onToggle && (
          <div onClick={(e) => e.stopPropagation()}>
            <Toggle on={ag.enabled} onChange={onToggle} size={14} />
          </div>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Delete agent "${ag.name}"? This cannot be undone.`)) del.mutate(ag.id);
          }}
          disabled={del.isPending}
          title="Delete agent"
          aria-label="Delete agent"
          style={{
            background: "none",
            border: "none",
            cursor: del.isPending ? "not-allowed" : "pointer",
            color: "var(--text-muted)",
            display: "inline-flex",
            padding: 4,
          }}
        >
          <Icon.Trash size={14} style={del.isPending ? { animation: "ddspin 1s linear infinite" } : undefined} />
        </button>
      </div>
      <div style={s.description}>{ag.description || t("card.noDescription")}</div>
      <div style={s.metaRow}>
        <span className="mono" style={s.modelChip(color)}>
          {ag.model}
        </span>
        {skillCount != null && (
          <Badge color="var(--text-secondary)" icon="Sparkles">
            {t("card.skillCount", { count: skillCount })}
          </Badge>
        )}
      </div>
      {stats != null && stats.runs > 0 && (
        <div style={s.statsRow}>
          <span>{t("card.runs", { count: stats.runs })}</span>
          {stats.accept_rate != null && (
            <span style={{ color: acceptRateColor(stats.accept_rate) }}>
              {t("card.acceptRate", { pct: stats.accept_rate })}
            </span>
          )}
          <span className="mono">{t("card.avgCost", { amount: formatCostUsd(stats.avg_cost_usd) })}</span>
        </div>
      )}
    </div>
  );
}
