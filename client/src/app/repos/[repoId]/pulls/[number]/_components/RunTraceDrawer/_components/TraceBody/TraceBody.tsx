/* TraceBody — the Trace tab content: Configuration, Stats, Findings, Prompt
   assembly, Tool calls, and Raw output sections for one persisted RunTrace. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";
import type { RunTrace, FindingRecord, ProjectContextOutcome } from "@devdigest/shared";
import { PROMPT_COLORS } from "../../constants";
import { formatSeconds, formatTokens } from "../../helpers";
import { formatCostUsd } from "@/lib/format";
import { approxTokens } from "@/lib/tokens";
import { s } from "../../styles";
import { TraceSection } from "../TraceSection";
import { ToolCallRow } from "../ToolCallRow";
import { PromptBlock } from "../PromptBlock";
import { FindingsSection } from "../FindingsSection";
import { Row, Stat } from "../atoms";

/** Badge tone per project-context run-time outcome (AC-29, AC-30). */
const PROJECT_CONTEXT_OUTCOME_TONE: Record<ProjectContextOutcome, { color: string; bg: string }> = {
  injected: { color: "var(--ok)", bg: "var(--ok-bg)" },
  missing: { color: "var(--text-muted)", bg: "var(--bg-hover)" },
  dropped_over_budget: { color: "var(--warn)", bg: "var(--warn-bg)" },
  truncated: { color: "var(--warn)", bg: "var(--warn-bg)" },
  wrong_repo: { color: "var(--crit)", bg: "var(--crit-bg)" },
  changed_unconfirmed: { color: "var(--crit)", bg: "var(--crit-bg)" },
};

/** Fallback tone for a persisted `outcome` string outside the known union —
 *  an older trace, or one written by a future server (AC-33). Looking this
 *  up must never throw: an unrecognised value degrades to this neutral tone
 *  (the badge's label falls back to next-intl's own missing-message
 *  handling, which never throws either) rather than blanking the drawer. */
const UNKNOWN_OUTCOME_TONE = PROJECT_CONTEXT_OUTCOME_TONE.missing;

export function TraceBody({ trace, findings }: { trace: RunTrace; findings: FindingRecord[] }) {
  const t = useTranslations("runs");
  const stats = trace.stats;
  return (
    <>
      <TraceSection icon="Settings" title={t("trace.configuration")}>
        <div style={s.configList}>
          <Row label={t("trace.config.model")}>
            <span className="mono" style={s.configModel}>
              {trace.config.model}
            </span>
          </Row>
          <Row label={t("trace.config.provider")}>
            <span className="mono" style={s.configProvider}>
              {trace.config.provider ?? "—"}
            </span>
          </Row>
          <Row label={t("trace.config.memoryPulled")}>
            <span>{t("trace.config.items", { count: trace.memory_pulled.length })}</span>
          </Row>
          <Row label={t("trace.config.specsRead")}>
            <div style={s.specsWrap}>
              {trace.specs_read.length === 0 ? (
                <span style={s.specsNone}>{t("trace.config.none")}</span>
              ) : (
                trace.specs_read.map((sp, i) => (
                  <span key={i} className="mono" style={s.spec}>
                    {sp}
                  </span>
                ))
              )}
            </div>
          </Row>
          {/* `project_context` is nullish, not `[]`, on every trace written before this
              feature — omit the row entirely rather than render it empty (AC-33). */}
          {trace.project_context != null && (
            <Row label={t("trace.config.projectContext")}>
              <div style={s.specsWrap}>
                {trace.project_context.length === 0 ? (
                  <span style={s.specsNone}>{t("trace.config.none")}</span>
                ) : (
                  trace.project_context.map((doc) => {
                    // `doc` comes from persisted, client-unvalidated trace JSON — an
                    // `outcome` outside the known union (an older trace, or one written
                    // by a future server) must degrade to a neutral tone rather than
                    // throw on `undefined.color` and blank the whole drawer (AC-33).
                    const tone =
                      (PROJECT_CONTEXT_OUTCOME_TONE as Partial<Record<string, { color: string; bg: string }>>)[
                        doc.outcome
                      ] ?? UNKNOWN_OUTCOME_TONE;
                    return (
                      <span key={doc.path} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span className="mono" style={s.spec}>
                          {doc.path}
                        </span>
                        <Badge color={tone.color} bg={tone.bg} dot>
                          {t(`trace.projectContext.outcome.${doc.outcome}`)}
                        </Badge>
                      </span>
                    );
                  })
                )}
              </div>
            </Row>
          )}
        </div>
      </TraceSection>

      <TraceSection
        icon="Gauge"
        title={t("trace.stats")}
        right={
          <Badge color="var(--ok)" bg="var(--ok-bg)" icon="Check">
            {stats.grounding}
          </Badge>
        }
      >
        <div style={s.statsRow}>
          <Stat label={t("trace.stat.duration")} val={formatSeconds(stats.duration_ms)} />
          <Stat label={t("trace.stat.tokens")} val={formatTokens(stats.tokens_in, stats.tokens_out)} />
          {/* Undefined for traces persisted before cost tracking existed → `—`. */}
          <Stat label={t("trace.stat.cost")} val={formatCostUsd(stats.cost_usd)} />
          <Stat label={t("trace.stat.findings")} val={stats.findings} />
        </div>
      </TraceSection>

      <FindingsSection findings={findings} />

      <TraceSection icon="FileText" title={t("trace.promptAssembly")} defaultOpen={false}>
        <PromptBlock label={t("trace.prompt.system")} text={trace.prompt_assembly.system} color={PROMPT_COLORS.system} />
        {trace.prompt_assembly.skills != null && (
          <PromptBlock
            label={`${t("trace.prompt.skills")} · ${t("trace.prompt.tokenCount", { count: approxTokens(trace.prompt_assembly.skills) })}`}
            text={trace.prompt_assembly.skills}
            color={PROMPT_COLORS.skills}
          />
        )}
        {trace.prompt_assembly.memory != null && (
          <PromptBlock label={t("trace.prompt.memory")} text={trace.prompt_assembly.memory} color={PROMPT_COLORS.memory} />
        )}
        {trace.prompt_assembly.repo_map != null && (
          <PromptBlock label={t("trace.prompt.repoMap")} text={trace.prompt_assembly.repo_map} color={PROMPT_COLORS.repoMap} />
        )}
        {trace.prompt_assembly.specs != null && (
          <PromptBlock label={t("trace.prompt.specs")} text={trace.prompt_assembly.specs} color={PROMPT_COLORS.specs} />
        )}
        {trace.prompt_assembly.callers != null && (
          <PromptBlock label={t("trace.prompt.callers")} text={trace.prompt_assembly.callers} color={PROMPT_COLORS.callers} />
        )}
        <PromptBlock label={t("trace.prompt.user")} text={trace.prompt_assembly.user} color={PROMPT_COLORS.user} />
      </TraceSection>

      <TraceSection
        icon="Wrench"
        title={t("trace.toolCalls")}
        right={<Badge color="var(--text-muted)">{trace.tool_calls.length}</Badge>}
      >
        {trace.tool_calls.length === 0 ? (
          <span style={s.noToolCalls}>{t("trace.noToolCalls")}</span>
        ) : (
          trace.tool_calls.map((tc, i) => <ToolCallRow key={i} tc={tc} />)
        )}
      </TraceSection>

      <TraceSection icon="Code" title={t("trace.rawOutput")} defaultOpen={false}>
        <pre className="mono" style={s.rawPre}>
          {trace.raw_output || "—"}
        </pre>
      </TraceSection>
    </>
  );
}
