/* BriefCard — the Overview tab's container for the PR Brief. Owns the one
   fetch (the brief query) and the one token-spending action (the generate
   mutation) for the whole brief: neither `IntentCard` nor `ReviewFocus` below
   carry their own recalculate control any more (see AC-43 — a brief-level
   task must never grow a second control that regenerates only part of
   itself).

   Render order, in order of precedence:
     1. loading            → skeletons
     2. `data == null`     → empty state (never renders any brief block next
                              to it — AC-2)
     3. `data != null`     → stale notice, degraded notice, verdict block
                              (omitted when there is no verdict yet — AC-30),
                              the Intent | Blast pair, ReviewFocus, footer.

   The card spans the full width of the Overview tab, and the Intent and Blast
   cards sit side by side WITHIN it (`s.pairGrid`). Blast arrives as the
   `blastSlot` node rather than an import, so this container never takes a
   dependency on `BlastCard` or on the blast query — `OverviewTab` still owns
   that composition and feeds it the deduped payload.

   `blastSlot` renders in EVERY branch, including the empty and loading ones: a
   pull request that has never been briefed must still show its blast radius,
   which is the no-regression rule the blast dedupe was built around.

   A failed generate/regenerate NEVER swaps out what is already on screen: the
   previously rendered brief (or the Description section this card sits
   above) stays mounted, and the failure surfaces as a small dismissible
   alert next to the control instead (AC-7). This is why `generate.isError`
   is read directly off the mutation rather than folded into an early
   return. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton, Icon, Button, CircularScore } from "@devdigest/ui";
import type { PrBriefDetail, BriefVerdictSummary, PrCommit } from "@devdigest/shared";
import { usePrBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { formatCostUsd, formatTokensCompact } from "@/lib/format";
import { IntentCard } from "../IntentCard";
import { ReviewFocus } from "./_components/ReviewFocus";
import { VERDICT_META } from "./constants";
import { s } from "./styles";

export interface BriefCardProps {
  prId: string | null;
  /** The PR's current head sha — compared against the persisted brief's own
   * `head_sha` to decide whether the brief is stale (AC-12). */
  prHeadSha: string;
  /** Ordered oldest-first, HEAD last — GitHub's own `pulls.listCommits`
   * ordering (`server/src/adapters/github/octokit.ts`), never re-sorted here.
   * Used only to count how many commits landed after the brief's head sha. */
  prCommits: PrCommit[];
  repoFullName: string | null;
  onOpenFileLine: (path: string, line: number) => void;
  /** The Blast Radius card, rendered as the right-hand half of the brief's
   * Intent | Blast pair. Passed as a node so this container stays independent
   * of `BlastCard` and of the blast query. Rendered in every state — a
   * never-briefed PR still shows its blast radius. */
  blastSlot?: React.ReactNode;
}

export function BriefCard({
  prId,
  prHeadSha,
  prCommits,
  repoFullName,
  onOpenFileLine,
  blastSlot,
}: BriefCardProps) {
  const t = useTranslations("brief");
  const { data, isLoading } = usePrBrief(prId);
  const generate = useGenerateBrief(prId);

  const hasBrief = data != null;
  const label =
    generate.isPending ? t("generating") : hasBrief ? t("refresh") : t("generate");

  // Referenced once, rendered at whichever of the two sites below is active
  // (empty state or the brief's own controls row) — never both at once, so
  // this is the single control in the file wired to the generate mutation's
  // trigger (the mechanical guard for AC-43).
  const generateButton = (
    <Button
      kind={hasBrief ? "secondary" : "primary"}
      icon="RefreshCw"
      disabled={prId == null || generate.isPending}
      onClick={() => generate.mutate()}
    >
      {label}
    </Button>
  );

  const errorAlert = generate.isError && (
    <div role="alert" style={s.errorBox}>
      <span style={s.errorText}>
        <Icon.AlertTriangle size={14} style={{ flexShrink: 0 }} aria-hidden="true" />
        {t("generateFailed")}
      </span>
      <button type="button" style={s.dismissBtn} onClick={() => generate.reset()}>
        {t("dismiss")}
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div style={s.wrap}>
        {/* Skeletons occupy the Intent half of the pair, so the blast card
            does not jump from full width to half when the brief resolves. */}
        <div style={s.pairGrid}>
          <div style={s.skeletonWrap}>
            <Skeleton height={16} width="40%" />
            <Skeleton height={120} />
          </div>
          {blastSlot}
        </div>
      </div>
    );
  }

  if (data == null) {
    return (
      <div style={s.wrap}>
        <div style={s.emptyBox}>
          <div style={s.emptyIconBox}>
            <Icon.FileText size={22} aria-hidden="true" />
          </div>
          <div style={s.emptyTitle}>{t("empty.title")}</div>
          <div style={s.emptyHint}>{t("empty.hint")}</div>
          {/* Spends-tokens disclosure BEFORE the control that spends them —
              AC-46. */}
          <div style={s.emptyTokenNotice}>{t("empty.tokenNotice")}</div>
          <div style={s.emptyControls}>
            {generateButton}
            {errorAlert}
          </div>
        </div>
        {/* No intent to pair with yet, so the empty box is the full-width
            hero and blast follows it at full width — but it is still here
            (AC-2 forbids a brief block beside the empty state, not the blast
            card, which is not part of the brief). */}
        {blastSlot}
      </div>
    );
  }

  const isStale = data.head_sha !== prHeadSha;
  const staleCommits = isStale ? commitsSince(prCommits, data.head_sha) : null;
  const isDegraded = data.status !== "ready";

  return (
    <div style={s.wrap}>
      <div style={s.controlsRow}>
        {generateButton}
        {errorAlert}
      </div>

      {isStale && (
        <div role="status" style={s.notice("warn")}>
          <Icon.Clock size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <span>
            <span style={s.noticeTitle}>{t("stale.title")}</span>
            {" — "}
            {staleCommits == null
              ? t("stale.unknownCommits")
              : t("stale.commits", { count: staleCommits })}
          </span>
        </div>
      )}

      {isDegraded && (
        <div role="status" style={s.notice("warn")}>
          <Icon.AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <span>
            <span style={s.noticeTitle}>{t("degraded.title")}</span>
            {" — "}
            {data.reason ?? t("degraded.reason")}
          </span>
        </div>
      )}

      {data.verdict_summary != null && <VerdictBlock summary={data.verdict_summary} />}

      <div style={s.pairGrid}>
        <IntentCard intent={data.intent} repoFullName={repoFullName} headSha={data.head_sha} />
        {blastSlot}
      </div>

      <ReviewFocus entries={data.review_focus} onOpenFileLine={onOpenFileLine} />

      <BriefFooter brief={data} />
    </div>
  );
}

/**
 * Count of commits in `commits` that landed after `sha` — `null` when `sha`
 * isn't found in the list (a rebase/force-push rewrote history since the
 * brief was generated), so the caller falls back to the generic
 * `stale.unknownCommits` copy instead of asserting a specific, possibly
 * wrong, number. Pure index lookup — no timestamp parsing, so it doesn't
 * depend on `committed_at` being present.
 */
function commitsSince(commits: PrCommit[], sha: string): number | null {
  const idx = commits.findIndex((c) => c.sha === sha);
  return idx === -1 ? null : commits.length - 1 - idx;
}

/** PR-level verdict rollup — omitted entirely by the caller when no review
 * run has completed yet (AC-30), so this never has to render a "no verdict"
 * placeholder itself. */
function VerdictBlock({ summary }: { summary: BriefVerdictSummary }) {
  const t = useTranslations("brief");
  // `summary.verdict` is server data that is never Zod-parsed on the client
  // (`api.get` casts, `lib/api.ts:62`) — fall back to a neutral entry before
  // dereferencing rather than letting an out-of-union value throw here.
  const meta = VERDICT_META[summary.verdict] ?? VERDICT_META.comment;
  const VIcon = Icon[meta.icon];
  return (
    <div style={s.verdictBox}>
      <div style={s.verdictIconBox(meta.bg, meta.c)}>
        <VIcon size={20} aria-hidden="true" />
      </div>
      <div style={s.verdictMain}>
        <span style={s.verdictLabel(meta.c)}>{t(`verdict.${summary.verdict}`)}</span>
        <div style={s.verdictStats}>
          <span>
            {t("verdict.findings")} <strong className="tnum">{summary.findings}</strong>
          </span>
          <span>
            {t("verdict.blockers")} <strong className="tnum">{summary.blockers}</strong>
          </span>
        </div>
      </div>
      {summary.score != null && (
        <div style={s.verdictScoreCol}>
          <CircularScore score={summary.score} size={48} stroke={4} />
          <span style={s.verdictScoreLabel}>{t("verdict.score")}</span>
        </div>
      )}
    </div>
  );
}

/** Tokens + cost + summarized-files rollup. `cost_usd` renders the catalogue
 * dash (never a bare zero-cost figure) whenever the model's price is unknown
 * — AC-29. */
function BriefFooter({ brief }: { brief: PrBriefDetail }) {
  const t = useTranslations("brief");
  const costText =
    brief.cost_usd == null ? t("footer.costUnknown") : formatCostUsd(brief.cost_usd);
  const tokensText = formatTokensCompact(brief.tokens_in + brief.tokens_out);
  return (
    <div style={s.footer}>
      <span>
        {t("footer.cost")} <span className="tnum">{costText}</span>
      </span>
      <span>
        {t("footer.tokens")} <span className="tnum">{tokensText}</span>
      </span>
      <span>
        {t("footer.summarized", { n: brief.summarized_files, m: brief.changed_files })}
      </span>
    </div>
  );
}
