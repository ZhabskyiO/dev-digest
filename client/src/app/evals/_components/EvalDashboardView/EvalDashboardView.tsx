/* EvalDashboardView — /evals sidebar page (L07). Regression harness across
   all reviewer agents: latest batch metrics + recall sparkline per agent
   (click-through to the agent's Evals tab), and the recent eval runs across
   all agents. Data: GET /evals/dashboard. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, EmptyState, Icon, SectionLabel, Skeleton, Sparkline } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell";
import { useEvalDashboard } from "../../../../lib/hooks/evals";
import { s } from "./styles";

function pct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const METRIC_COLORS = ["var(--accent)", "var(--ok)", "var(--warn)"] as const;

export function EvalDashboardView() {
  const t = useTranslations("eval");
  const router = useRouter();
  const { data, isLoading } = useEvalDashboard();

  const crumb = [{ label: t("page.crumbSkillsLab") }, { label: t("page.crumbEvalDashboard") }];

  return (
    <AppShell crumb={crumb}>
      <div style={s.wrap}>
        <div>
          <h1 style={s.title}>{t("dashboard.defaultTitle")}</h1>
          <p style={s.subtitle}>{t("dashboard.subtitle")}</p>
        </div>

        <SectionLabel>{t("dashboard.agents")}</SectionLabel>
        {isLoading ? (
          <div style={s.list}>
            <Skeleton height={70} />
            <Skeleton height={70} />
          </div>
        ) : !data || data.agents.length === 0 ? (
          <EmptyState icon="Gauge" title={t("dashboard.noRuns")} body={t("dashboard.empty")} />
        ) : (
          <div style={s.list}>
            {data.agents.map((a) => {
              const l = a.latest;
              const values = l ? [l.recall, l.precision, l.citation_accuracy] : [];
              const labels = [
                t("dashboard.metrics.recall"),
                t("dashboard.metrics.precision"),
                t("dashboard.metrics.citationAccuracy"),
              ];
              return (
                <button
                  key={a.agent_id}
                  type="button"
                  style={s.agentRow}
                  data-testid="eval-agent-row"
                  onClick={() => router.push(`/agents/${a.agent_id}?tab=evals`)}
                >
                  <div style={s.agentIcon}>
                    <Icon.Cpu size={16} style={{ color: "var(--accent)" }} />
                  </div>
                  <div style={s.agentMain}>
                    <div style={s.agentName}>
                      {a.agent_name}
                      <Badge color="var(--text-secondary)" mono>
                        {a.model}
                      </Badge>
                    </div>
                    <div style={s.agentSub}>
                      {l
                        ? t("dashboard.lastRun", {
                            version: l.agent_version ?? "?",
                            date: fmtDate(l.ran_at),
                            passed: l.passed,
                            total: l.total,
                          })
                        : t("dashboard.neverRun")}
                      {" · "}
                      {t("dashboard.casesCount", { count: a.cases_total })}
                    </div>
                  </div>
                  {a.trend.length > 1 && <Sparkline data={a.trend} color="var(--accent)" w={90} h={26} />}
                  {l &&
                    values.map((v, i) => (
                      <div key={labels[i]} style={s.metric}>
                        <div style={s.metricLabel}>{labels[i]}</div>
                        <div style={s.metricValue(METRIC_COLORS[i]!)}>{pct(v)}</div>
                      </div>
                    ))}
                  <Icon.ChevronRight size={16} style={{ color: "var(--text-muted)" }} />
                </button>
              );
            })}
          </div>
        )}

        <SectionLabel>{t("dashboard.recentAll")}</SectionLabel>
        {isLoading ? (
          <Skeleton height={120} />
        ) : !data || data.recent.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</p>
        ) : (
          <div style={s.list}>
            {data.recent.map((b) => (
              <div key={b.batch_id} style={s.recentRow} data-testid="eval-recent-row">
                <span style={s.recentAgent}>{b.agent_name}</span>
                <span style={s.recentDate}>{fmtDate(b.ran_at)}</span>
                <Badge color="var(--accent)" mono>
                  {t("compare.version", { version: b.agent_version ?? "?" })}
                </Badge>
                <span style={s.recentMetric("var(--accent)")}>{pct(b.recall)}</span>
                <span style={s.recentMetric("var(--ok)")}>{pct(b.precision)}</span>
                <span style={s.recentMetric("var(--warn)")}>{pct(b.citation_accuracy)}</span>
                <span style={s.recentPassed}>
                  {b.passed}/{b.total}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
