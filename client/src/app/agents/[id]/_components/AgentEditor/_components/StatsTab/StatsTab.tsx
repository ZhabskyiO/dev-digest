/* StatsTab — agent editor Stats tab. Ships the 4 KPI tiles (total runs, avg
   cost/run, avg duration, accept rate — all real, computed from agent_runs
   via GET /agents/:id/stats) plus MOST-USED SKILLS (GET /skills/usage). The
   other two mockup panels — MOST-PULLED MEMORY and FINDINGS BY CATEGORY —
   are deliberately skipped rather than shown with fabricated numbers: memory
   pull-tracking doesn't exist yet (L07), and cost isn't attributed per
   finding/category anywhere in this schema. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { BarRow, MetricCard, RingProgress, Skeleton } from "@devdigest/ui";
import type { Agent } from "@devdigest/shared";
import { useAgentStats } from "../../../../../../../lib/hooks/agents";
import { useSkillUsage } from "../../../../../../../lib/hooks/skills";
import { formatCostUsd, formatDurationMs, NO_VALUE } from "../../../../../../../lib/format";
import { acceptRateColor, maxRuns } from "./helpers";
import { s } from "./styles";

const STATS_WINDOW_DAYS = 30;

export function StatsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const { data: stats, isLoading: statsLoading } = useAgentStats(agent.id, STATS_WINDOW_DAYS);
  const { data: usage, isLoading: usageLoading } = useSkillUsage(agent.id);

  const rows = usage ?? [];
  const max = maxRuns(rows);

  return (
    <div style={s.wrap}>
      {statsLoading ? (
        <div style={s.tiles}>
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
          <Skeleton height={92} />
        </div>
      ) : (
        <div style={s.tiles}>
          <MetricCard
            label={t("stats.totalRuns")}
            value={stats?.runs ?? 0}
            trend={stats?.trend && stats.trend.length > 0 ? stats.trend : undefined}
          />
          <MetricCard
            label={t("stats.avgCostPerRun")}
            value={formatCostUsd(stats?.avg_cost_usd)}
            delta={stats?.avg_cost_usd_delta ?? undefined}
            deltaPrefix="$"
          />
          <MetricCard label={t("stats.avgDuration")} value={formatDurationMs(stats?.avg_duration_ms)} />
          <MetricCard
            label={t("stats.acceptRate")}
            value={stats?.accept_rate != null ? stats.accept_rate : NO_VALUE}
            suffix={stats?.accept_rate != null ? "%" : undefined}
            badge={
              stats?.accept_rate != null ? (
                <RingProgress value={stats.accept_rate} color={acceptRateColor(stats.accept_rate)} />
              ) : undefined
            }
          />
        </div>
      )}

      <div style={s.panel}>
        <div style={s.header}>
          <h2 style={s.h2}>{t("stats.mostUsedSkills")}</h2>
        </div>
        <p style={s.caveat}>{t("stats.caveat")}</p>
        {usageLoading ? (
          <Skeleton height={140} />
        ) : rows.length === 0 ? (
          <p style={s.empty}>{t("stats.empty")}</p>
        ) : (
          <div style={s.list}>
            {rows.map((row) => (
              <BarRow key={row.skill_id} label={row.name} value={row.runs} max={max} suffix={`${row.pct}%`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
