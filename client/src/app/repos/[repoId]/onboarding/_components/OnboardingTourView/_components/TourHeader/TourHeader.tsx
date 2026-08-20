/* TourHeader — the header title built from `headingPrefix` + the repo's
   short name (AC-35), the subtitle built from
   the stored tour's own `indexed_file_count` / `generated_at` (never
   hardcoded, AC-25), the stale/degraded/generating/failed notices, and the
   Regenerate / Share link actions (AC-35, AC-26, AC-27, AC-28, AC-29, AC-7,
   AC-40). The repository's breadcrumb itself is rendered by AppShell's own
   `crumb` prop (OnboardingTourView computes it) — this component owns only
   the page-content header below it. */
"use client";

import { useTranslations } from "next-intl";
import { Button, Icon, IconBtn } from "@devdigest/ui";
import type { Onboarding, OnboardingTourResponse } from "@devdigest/shared";
import { formatGeneratedAt, repoShortName } from "../../helpers";
import { s } from "./styles";

export function TourHeader({
  repoFullName,
  tour,
  state,
  stale,
  failureReason,
  failedDismissed,
  onDismissFailed,
  regenerateDisabled,
  isGenerating,
  onRegenerate,
  onShare,
  shareCopied,
}: {
  repoFullName: string | null | undefined;
  tour: Onboarding;
  state: OnboardingTourResponse["state"];
  stale: boolean;
  /** Non-null only while `state === "failed"`. */
  failureReason: string | null | undefined;
  failedDismissed: boolean;
  onDismissFailed: () => void;
  regenerateDisabled: boolean;
  isGenerating: boolean;
  onRegenerate: () => void;
  onShare: () => void;
  shareCopied: boolean;
}) {
  const t = useTranslations("onboarding");
  const tCommon = useTranslations("common");
  const shortName = repoShortName(repoFullName);

  return (
    <div style={s.noticeStack}>
      <div style={s.row}>
        <div style={s.titleCol}>
          <h1 style={s.title}>
            {t("headingPrefix")}
            <span style={s.repoName}>{shortName}</span>
          </h1>
          <p style={s.subtitle}>
            {t("subtitle", {
              count: tour.indexed_file_count,
              time: formatGeneratedAt(tour.generated_at),
            })}
            {stale && ` · ${t("notice.stale")}`}
          </p>
        </div>
        <div style={s.actions}>
          <Button kind="secondary" icon="RefreshCw" onClick={onRegenerate} disabled={regenerateDisabled}>
            {isGenerating ? t("regenerating") : t("regenerate")}
          </Button>
          <Button kind="secondary" icon="Link" onClick={onShare}>
            {shareCopied ? t("shareCopied") : t("shareLink")}
          </Button>
        </div>
      </div>

      {tour.degraded_reason && (
        <div style={s.notice}>
          <span style={s.noticeText}>
            <Icon.Info size={15} style={{ color: "var(--warn)", flexShrink: 0, marginTop: 1 }} />
            {t("notice.degraded", { reason: tour.degraded_reason })}
          </span>
        </div>
      )}

      {isGenerating && (
        <div style={s.notice}>
          <span style={s.noticeText}>
            <Icon.RefreshCw size={15} style={{ color: "var(--text-muted)", flexShrink: 0, marginTop: 1 }} />
            {t("notice.generating")}
          </span>
        </div>
      )}

      {state === "failed" && failureReason && !failedDismissed && (
        <div style={s.notice}>
          <span style={s.noticeText}>
            <Icon.AlertTriangle size={15} style={{ color: "var(--crit)", flexShrink: 0, marginTop: 1 }} />
            {t("notice.failed", { reason: failureReason })}
          </span>
          <IconBtn icon="X" label={tCommon("actions.close")} onClick={onDismissFailed} size={22} />
        </div>
      )}
    </div>
  );
}
