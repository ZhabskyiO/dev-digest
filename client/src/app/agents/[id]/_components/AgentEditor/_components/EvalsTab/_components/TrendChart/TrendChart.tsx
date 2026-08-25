/* TrendChart — recall / precision / citation_accuracy across ALL of the
   agent's eval batches (chronological; point = one full-set run). Hover shows
   the prompt version and run cost — "CI as a trend": watch the drift first,
   thresholds later. Colors follow the entities everywhere else in the eval UI
   (recall=accent, precision=ok, citation=warn); identity is never color-alone:
   a legend row names each series. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  LineChart as RLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { EvalBatch } from "@devdigest/shared";
import { formatCostUsd } from "../../../../../../../../../lib/format";
import { fmtRanAt } from "../../helpers";

const SERIES = [
  { key: "recall", color: "var(--accent)" },
  { key: "precision", color: "var(--ok)" },
  { key: "citation", color: "var(--warn)" },
] as const;

interface Point {
  i: number;
  recall: number;
  precision: number;
  citation: number;
  version: number | null;
  cost: number | null;
  ranAt: string;
  passed: number;
  total: number;
}

export function TrendChart({ batches }: { batches: EvalBatch[] }) {
  const t = useTranslations("eval");
  // history arrives newest-first; the trend reads left → right in time
  const points: Point[] = [...batches].reverse().map((b, i) => ({
    i,
    recall: b.recall ?? 0,
    precision: b.precision ?? 0,
    citation: b.citation_accuracy ?? 0,
    version: b.agent_version,
    cost: b.cost_usd,
    ranAt: b.ran_at,
    passed: b.passed,
    total: b.total,
  }));

  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 6 }}>
        {SERIES.map((s) => (
          <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>
            <span style={{ width: 10, height: 3, borderRadius: 2, background: s.color, display: "inline-block" }} />
            {t(`dashboard.legend.${s.key}`)}
          </span>
        ))}
      </div>
      <div style={{ width: "100%", height: 190 }} data-testid="eval-trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          <RLineChart data={points} margin={{ top: 10, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="i" hide />
            <YAxis
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              tick={{ fontSize: 11, fill: "var(--text-muted)" }}
              tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
              axisLine={false}
              tickLine={false}
              width={46}
            />
            <Tooltip
              cursor={{ stroke: "var(--border-strong, var(--border))" }}
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as Point | undefined;
                if (!active || !p) return null;
                return (
                  <div
                    style={{
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "8px 12px",
                      fontSize: 12,
                      color: "var(--text-primary)",
                      boxShadow: "0 4px 14px rgba(0,0,0,.25)",
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {t("compare.version", { version: p.version ?? "?" })}
                      <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                        {" · "}{fmtRanAt(p.ranAt)}{" · "}{formatCostUsd(p.cost)}
                      </span>
                    </div>
                    {SERIES.map((s) => (
                      <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.color }} />
                        {t(`dashboard.legend.${s.key}`)}: {Math.round(p[s.key] * 100)}%
                      </div>
                    ))}
                    <div style={{ color: "var(--text-muted)", marginTop: 3 }}>
                      {p.passed}/{p.total} {t("evalsTab.traces")}
                    </div>
                  </div>
                );
              }}
            />
            {SERIES.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 3, fill: s.color, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            ))}
          </RLineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
