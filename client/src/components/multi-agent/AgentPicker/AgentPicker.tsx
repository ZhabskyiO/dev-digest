/* AgentPicker — the one component both multi-agent-review surfaces render:
   the full configure-run page (large checkbox cards, `variant: "full"`)
   and the PR-detail quick picker dropdown (dense checkbox rows,
   `variant: "compact"`). Presentational + controlled: the screen owns
   `selected` and persists it; this component only reports toggle intents
   and renders one row per WORKSPACE agent (not just enabled/attached ones),
   its per-agent estimate, and the checked-set aggregate.

   Icon: `Agent` carries no icon field, so every row uses the same `Cpu`
   glyph AgentCard already uses elsewhere — there is no per-agent icon data
   to key off, and adding one is a contract change outside this task.

   Estimate rendering never shows "$0.00" for a missing price (AC-9) — it
   reuses `formatCostUsd`, whose whole contract is "null renders '—', never
   a fabricated zero" (`lib/format.ts`). The aggregate is derived at render
   time from `props.selected` + `props.estimates` via the pure
   `aggregateEstimate` helper — no `useState`/`useEffect` mirror of it. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Icon, EmptyState, Button } from "@devdigest/ui";
import type { Agent, AgentRunEstimate, PrAgentEstimates } from "@devdigest/shared";
import { formatCostUsd } from "@/lib/format";
import { aggregateEstimate, estimateForAgent, toSeconds } from "./helpers";
import { s } from "./styles";

export type AgentPickerVariant = "full" | "compact";

export interface AgentPickerProps {
  /** Every agent in the workspace — not filtered to enabled/attached ones;
   *  the caller decides which set to pass. */
  agents: Agent[];
  /** Undefined while the estimates request is still loading — every row
   *  then falls back to "no estimate yet" rather than blocking the picker. */
  estimates: PrAgentEstimates | undefined;
  /** Controlled: the checked agent ids, owned by the caller. */
  selected: string[];
  onChange: (selected: string[]) => void;
  variant: AgentPickerVariant;
  onSubmit: () => void;
  submitting: boolean;
}

export function AgentPicker({
  agents,
  estimates,
  selected,
  onChange,
  variant,
  onSubmit,
  submitting,
}: AgentPickerProps) {
  const t = useTranslations("runs");
  const tPicker = useTranslations("prReview");
  const router = useRouter();

  if (agents.length === 0) {
    return (
      <EmptyState
        icon="Users"
        title={t("page.noAgents.title")}
        body={t("page.noAgents.body")}
        cta={t("page.noAgents.cta")}
        onCta={() => router.push("/agents")}
      />
    );
  }

  const selectedSet = new Set(selected);

  const setChecked = (agentId: string, checked: boolean) => {
    if (checked) {
      if (selectedSet.has(agentId)) return;
      onChange([...selected, agentId]);
    } else {
      onChange(selected.filter((id) => id !== agentId));
    }
  };

  const aggregate = aggregateEstimate(selected, estimates);
  const hasAggregate = aggregate.duration_ms != null || aggregate.cost_usd != null;
  // `toSeconds` returns `null` when NO checked agent has a duration estimate
  // at all — NEVER fold that into `?? 0` here, or the aggregate line reads
  // "At least 0s · $0.06 · ..." for a real cost paired with a fabricated
  // duration. When duration is unknown, the aggregate line falls back to the
  // cost alone (still real data, never a fake zero).
  const aggregateDurationSec = toSeconds(aggregate.duration_ms);
  const aggregateCost = formatCostUsd(aggregate.cost_usd);

  const runLabel =
    variant === "full"
      ? t("page.configure.submit", { count: selected.length })
      : tPicker("runReview.picker.run", { count: selected.length });

  return (
    <div style={s.root}>
      <div style={s.toolbar}>
        {variant === "full" ? (
          <button type="button" style={s.linkButton} onClick={() => onChange(agents.map((a) => a.id))}>
            {t("page.configure.selectAll")}
          </button>
        ) : (
          <button type="button" style={s.linkButton} onClick={() => onChange([])}>
            {t("page.configure.clear")}
          </button>
        )}
      </div>
      <div style={s.list(variant)} role="list">
        {agents.map((agent) => (
          <AgentPickerRow
            key={agent.id}
            agent={agent}
            estimate={estimateForAgent(agent.id, estimates)}
            checked={selectedSet.has(agent.id)}
            variant={variant}
            onToggle={(checked) => setChecked(agent.id, checked)}
          />
        ))}
      </div>
      <div style={s.footer}>
        <Button
          kind="primary"
          icon="Users"
          disabled={selected.length === 0 || submitting}
          loading={submitting}
          onClick={onSubmit}
        >
          {runLabel}
        </Button>
        {variant === "full" && hasAggregate && (
          <span style={s.aggregate} className="mono">
            {aggregateDurationSec == null
              ? aggregateCost
              : aggregate.incomplete
                ? t("page.configure.aggregateAtLeast", { duration: aggregateDurationSec, cost: aggregateCost })
                : t("page.configure.aggregate", { duration: aggregateDurationSec, cost: aggregateCost })}
          </span>
        )}
      </div>
    </div>
  );
}

function AgentPickerRow({
  agent,
  estimate,
  checked,
  variant,
  onToggle,
}: {
  agent: Agent;
  estimate: AgentRunEstimate | undefined;
  checked: boolean;
  variant: AgentPickerVariant;
  onToggle: (checked: boolean) => void;
}) {
  const t = useTranslations("runs");
  const tPicker = useTranslations("prReview");

  const durationSeconds = toSeconds(estimate?.est_duration_ms ?? null);
  const costUsd = estimate?.est_cost_usd ?? null;
  const noEstimateAtAll = durationSeconds == null && costUsd == null;

  const durationLabel =
    durationSeconds == null
      ? variant === "full"
        ? t("page.configure.estimateNone")
        : tPicker("runReview.picker.estimateNone")
      : variant === "full"
        ? t("page.configure.estimateDuration", { duration: durationSeconds })
        : tPicker("runReview.picker.estimate", { duration: durationSeconds });

  const costLabel =
    costUsd == null ? t("page.configure.estimateNone") : t("page.configure.estimateCost", { cost: formatCostUsd(costUsd) });

  // A single dash when there is no estimate at all — "— · —" would be a
  // duplicated "no data" signal for the same missing history. Once EITHER
  // field is present, show both (the other falls back to its own "—").
  const estimateText =
    variant === "compact"
      ? durationLabel
      : noEstimateAtAll
        ? t("page.configure.estimateNone")
        : `${durationLabel} · ${costLabel}`;

  return (
    <div role="listitem" style={s.row(variant, checked)} onClick={() => onToggle(!checked)}>
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={agent.name}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(!checked);
        }}
        style={s.checkbox(checked)}
      >
        {checked && <Icon.Check size={11} style={{ color: "#fff" }} />}
      </button>
      <div style={s.iconBox}>
        <Icon.Cpu size={13} />
      </div>
      <div style={s.body}>
        <div style={s.nameRow}>
          <span style={s.name}>{agent.name}</span>
          <span style={s.estimate} className="mono">
            {estimateText}
          </span>
        </div>
        {variant === "full" && estimate?.last_summary != null && (
          <p style={s.summary}>{estimate.last_summary}</p>
        )}
      </div>
    </div>
  );
}
