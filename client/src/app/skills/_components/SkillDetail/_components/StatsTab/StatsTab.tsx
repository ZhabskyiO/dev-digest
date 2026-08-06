/* StatsTab — is this skill earning its place in the prompt?
   Four tiles plus the agents it's attached to and its findings-by-category mix.

   Nothing here is fabricated: every ratio the server can't compute arrives as
   null and renders NO_VALUE ("—"), never 0. The caveat under the tiles is not
   decoration — findings are attributed per RUN, and a run attaches several
   skills, so a finding is credited to all of them. */
"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Donut, Icon, MetricCard, RingProgress, Skeleton } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { useSkillAgents, useSkillStats } from "../../../../../../lib/hooks/skills";
import { NO_VALUE } from "../../../../../../lib/format";
import { STATS_WINDOW_DAYS } from "../../constants";
import { acceptRateColor, toDonutSegments } from "./helpers";
import { s } from "./styles";

export function StatsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: stats, isLoading } = useSkillStats(skill.id, STATS_WINDOW_DAYS);
  const { data: agents, isLoading: agentsLoading } = useSkillAgents(skill.id);

  const acceptRate = stats?.accept_rate ?? null;
  const pullPct = stats?.pull_pct ?? null;
  const segments = toDonutSegments(stats?.by_category ?? []);

  return (
    <div style={s.wrap}>
      <div style={s.tiles}>
        {isLoading ? (
          <>
            <Skeleton height={92} />
            <Skeleton height={92} />
            <Skeleton height={92} />
            <Skeleton height={92} />
          </>
        ) : (
          <>
            <MetricCard
              label={t("stats.usedBy")}
              value={stats?.agents_using ?? 0}
              suffix={t("stats.usedByUnit", { count: stats?.agents_using ?? 0 })}
            />
            <MetricCard
              label={t("stats.pullFrequency")}
              value={pullPct ?? NO_VALUE}
              {...(pullPct !== null ? { suffix: "%" } : {})}
            />
            <MetricCard
              label={t("stats.acceptRate")}
              value={acceptRate ?? NO_VALUE}
              {...(acceptRate !== null ? { suffix: "%" } : {})}
              {...(acceptRate !== null
                ? {
                    badge: (
                      <RingProgress value={acceptRate} color={acceptRateColor(acceptRate)} />
                    ),
                  }
                : {})}
            />
            <MetricCard
              label={t("stats.findings", { days: STATS_WINDOW_DAYS })}
              value={stats?.findings ?? 0}
            />
          </>
        )}
      </div>

      <p style={s.caveat}>{t("stats.caveat")}</p>

      <div style={s.panels}>
        <div style={s.panel}>
          <div style={s.panelHead}>
            <Icon.Cpu size={13} />
            {t("stats.agentsHeading")}
          </div>
          {agentsLoading ? (
            <Skeleton height={44} />
          ) : (agents?.length ?? 0) === 0 ? (
            <div style={s.empty}>{t("stats.agentsEmpty")}</div>
          ) : (
            agents!.map((a) => (
              <div key={a.id} style={s.agentRow}>
                <Icon.Cpu size={14} style={{ color: "var(--accent)", flexShrink: 0 }} />
                <span style={s.agentName}>{a.name}</span>
                <Button
                  kind="ghost"
                  size="sm"
                  onClick={() => router.push(`/agents/${a.id}`)}
                >
                  {t("stats.open")}
                </Button>
              </div>
            ))
          )}
        </div>

        <div style={s.panel}>
          <div style={s.panelHead}>
            <Icon.Tag size={13} />
            {t("stats.categoryHeading")}
          </div>
          {isLoading ? (
            <Skeleton height={130} />
          ) : segments.length === 0 ? (
            <div style={s.empty}>{t("stats.categoryEmpty")}</div>
          ) : (
            // Donut's legend defaults to a "$" prefix and 2 decimals; these are
            // counts, so the prefix has to be cleared explicitly.
            <Donut segments={segments} valuePrefix="" />
          )}
        </div>
      </div>
    </div>
  );
}
