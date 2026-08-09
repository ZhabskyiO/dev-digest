"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button, Icon } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { SmartDiffViewer } from "../SmartDiffViewer";
import { usePrComments, useCreatePrComment, usePrReviews, usePrRuns } from "@/lib/hooks/reviews";
import { findingsFromLatestRunPerAgent } from "@/lib/findings";
import { formatTokensCompact } from "@/lib/format";
import { notify } from "@/lib/toast";
import type { PrFile } from "@devdigest/shared";
import { priorReviewTokens } from "./helpers";
import { s } from "./styles";

interface DiffTabProps {
  prId: string | null;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
  /** Clicking a severity badge leaves the diff for the finding in full. */
  onOpenFinding?: (findingId: string) => void;
}

export function DiffTab({ prId, filesCount, files, canComment, onOpenFinding }: DiffTabProps) {
  const t = useTranslations("prReview");
  const { data: reviews } = usePrReviews(prId);
  const { data: runs } = usePrRuns(prId);
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);
  /* Smart order is the default: the whole point of the feature is that the
     reviewer meets core logic before lockfiles. "Original order" stays one
     click away for anyone reconciling against GitHub's file list. */
  const [smart, setSmart] = React.useState(true);

  const commentCount = comments?.length ?? 0;
  /* Same set Smart Diff badges from, so switching to Original order shows the
     same findings on the same lines rather than silently dropping them. */
  const currentFindings = React.useMemo(() => findingsFromLatestRunPerAgent(reviews), [reviews]);
  const selectFinding = React.useMemo(
    () => (onOpenFinding ? (f: { id: string }) => onOpenFinding(f.id) : undefined),
    [onOpenFinding],
  );
  /* Neither order calls a model — both are computed from the deterministic
     smart-diff grouping plus the findings the last review already persisted.
     The note makes that explicit and credits the spend it reuses. */
  const builtOnTokens = React.useMemo(() => priorReviewTokens(runs), [runs]);
  const totals = React.useMemo(
    () =>
      files.reduce(
        (acc, f) => ({ add: acc.add + f.additions, del: acc.del + f.deletions }),
        { add: 0, del: 0 },
      ),
    [files],
  );

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment && !!prId,
    showComments,
    posting: create.isPending,
    onSubmit: async (input) => {
      try {
        const res = await create.mutateAsync(input);
        setShowComments(true); // a just-posted comment shouldn't stay hidden
        return res;
      } catch (err) {
        notify.error(err instanceof Error ? err.message : "Couldn't post the comment to GitHub.");
        throw err;
      }
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {showComments ? "Hide comments" : "Show comments"} ({commentCount})
            </Button>
          ) : undefined
        }
      >
        {t("smartDiff.sectionLabel")}
      </SectionLabel>

      <div style={s.bar}>
        <span style={s.summary}>
          {t("smartDiff.summary", { count: filesCount })}
          {" · "}
          <span className="mono tnum" style={s.add}>
            +{totals.add}
          </span>{" "}
          <span className="mono tnum" style={s.del}>
            −{totals.del}
          </span>
        </span>

        <div style={s.segmented} role="group" aria-label={t("smartDiff.sectionLabel")}>
          <button
            type="button"
            aria-pressed={smart}
            style={smart ? s.segActive : s.seg}
            onClick={() => setSmart(true)}
          >
            {t("smartDiff.smartOrder")}
          </button>
          <button
            type="button"
            aria-pressed={!smart}
            style={smart ? s.seg : s.segActive}
            onClick={() => setSmart(false)}
          >
            {t("smartDiff.originalOrder")}
          </button>
        </div>
      </div>

      {/* Held back until the run history lands — rendering it early would flash
          "no review has run yet" on a PR that has in fact been reviewed. */}
      {runs !== undefined && (
        <div style={s.tokenNote} title={t("smartDiff.tokenNoteTitle")}>
          <Icon.Zap size={14} style={s.bolt} aria-hidden="true" />
          <span>
            {builtOnTokens > 0
              ? t("smartDiff.tokenNote", { tokens: formatTokensCompact(builtOnTokens) })
              : t("smartDiff.tokenNoteNoReview")}
          </span>
        </div>
      )}

      {smart ? (
        <SmartDiffViewer
          prId={prId}
          files={files}
          commenting={commenting}
          {...(selectFinding ? { onSelectFinding: selectFinding } : {})}
        />
      ) : (
        <DiffViewer
          files={files}
          commenting={commenting}
          findings={currentFindings}
          {...(selectFinding ? { onSelectFinding: selectFinding } : {})}
        />
      )}
    </section>
  );
}
