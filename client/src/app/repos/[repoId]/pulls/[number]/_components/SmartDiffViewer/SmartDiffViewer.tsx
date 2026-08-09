/* SmartDiffViewer — the reviewer-ordered Files-changed view: the PR's files
   grouped core → wiring → boilerplate and, inside each group, ordered
   findings-first.

   The grouping comes from `GET /pulls/:id/smart-diff`, which is deterministic
   and makes NO model call — viewing this tab must never cost a token. The
   badges and line highlighting come from findings the LAST review already
   persisted; before any review has run the groups still render, just without
   badges. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Icon, Skeleton } from "@devdigest/ui";
import type { PrFile, SmartDiffFile, SmartDiffRole } from "@devdigest/shared";
import {
  FileCard,
  annotationsFor,
  diffLineAnchorId,
  type DiffCommentApi,
  type LineFinding,
} from "@/components/diff-viewer";
import { useSmartDiff, usePrReviews } from "@/lib/hooks/reviews";
import { findingsFromLatestRunPerAgent } from "@/lib/findings";
import { AUTO_EXPAND_MAX_LINES, AUTO_EXPAND_ROLES, ROLE_STYLE } from "./constants";
import { s } from "./styles";

interface SmartDiffViewerProps {
  prId: string | null;
  /** PR files from the detail payload — the only source of `patch` text. */
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Clicking a line's severity badge leaves the diff for the finding in full. */
  onSelectFinding?: (finding: LineFinding) => void;
}

/** Whether a file starts expanded. See AUTO_EXPAND_ROLES for why boilerplate never does. */
function opensByDefault(role: SmartDiffRole, file: SmartDiffFile): boolean {
  if (!AUTO_EXPAND_ROLES.includes(role)) return false;
  if (file.finding_lines.length > 0) return true;
  return file.additions + file.deletions <= AUTO_EXPAND_MAX_LINES;
}

export function SmartDiffViewer({ prId, files, commenting, onSelectFinding }: SmartDiffViewerProps) {
  const t = useTranslations("prReview");
  const tShell = useTranslations("shell");
  const { data: smart, isLoading } = useSmartDiff(prId);
  // Already cached by the page's own usePrReviews — no extra request.
  // `findingsFromLatestRunPerAgent` is the SAME rule the server applies when it
  // computes `finding_lines`, so a badge's count always agrees with the lines
  // it jumps to. Keep the two in step (see the note on the lib helper).
  const { data: reviews } = usePrReviews(prId);
  const currentFindings = React.useMemo(() => findingsFromLatestRunPerAgent(reviews), [reviews]);

  const patchByPath = React.useMemo(
    () => new Map(files.map((f) => [f.path, f])),
    [files],
  );

  /* Open state is owned here, not by each FileCard, so clicking a findings
     badge on a collapsed file can expand it and scroll in one action.
     Seeded lazily from the server's grouping the first time it arrives, then
     left alone — a refetch must not slam shut a file the reviewer opened. */
  const [openPaths, setOpenPaths] = React.useState<Record<string, boolean> | null>(null);
  React.useEffect(() => {
    if (!smart || openPaths) return;
    const seed: Record<string, boolean> = {};
    for (const group of smart.groups) {
      for (const file of group.files) seed[file.path] = opensByDefault(group.role, file);
    }
    setOpenPaths(seed);
  }, [smart, openPaths]);

  /* Scroll requests are queued as state rather than done in the click handler:
     the target line may live inside a file that is still collapsed at click
     time, so the scroll has to wait for the expanded DOM to commit. */
  const [scrollTo, setScrollTo] = React.useState<{ path: string; line: number } | null>(null);
  React.useEffect(() => {
    if (!scrollTo) return;
    const el = document.getElementById(diffLineAnchorId(scrollTo.path, scrollTo.line));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    setScrollTo(null);
  }, [scrollTo]);

  if (isLoading || !smart) {
    return (
      <div style={s.skeletonWrap}>
        <Skeleton height={18} width={180} />
        <Skeleton height={44} />
        <Skeleton height={44} />
      </div>
    );
  }

  if (smart.groups.length === 0) {
    return <div style={s.empty}>{tShell("diffViewer.noChangedFiles")}</div>;
  }

  const jumpToFirstFinding = (file: SmartDiffFile) => {
    const line = file.finding_lines[0];
    if (line == null) return;
    setOpenPaths((prev) => ({ ...prev, [file.path]: true }));
    setScrollTo({ path: file.path, line });
  };

  return (
    <div style={s.wrap}>
      {smart.split_suggestion.too_big && (
        <div style={s.splitBox}>
          <div style={s.splitTitle}>
            <Icon.AlertTriangle size={14} aria-hidden="true" />
            {t("smartDiff.largeTitle", { lines: smart.split_suggestion.total_lines })}
          </div>
          {smart.split_suggestion.proposed_splits.length > 0 && (
            <>
              <p style={s.splitBody}>{t("smartDiff.largeBody")}</p>
              <ul style={s.splitList}>
                {smart.split_suggestion.proposed_splits.map((split) => (
                  <li key={split.name} style={s.splitChip}>
                    <span className="mono">{split.name}</span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {t("smartDiff.filesCount", { count: split.files.length })}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {smart.groups.map((group) => {
        const role = ROLE_STYLE[group.role];
        return (
          <section key={group.role} style={s.group}>
            <div style={s.groupHeader}>
              <span style={{ ...s.groupDot, background: role.color }} aria-hidden="true" />
              <span style={s.groupLabel}>{t(`smartDiff.role.${group.role}.label`)}</span>
              <span style={s.groupHint}>{t(`smartDiff.role.${group.role}.hint`)}</span>
              <span style={s.groupCount}>
                {t("smartDiff.filesCount", { count: group.files.length })}
              </span>
            </div>

            {group.files.map((file) => {
              // A file the smart-diff knows about but the detail payload has no
              // patch for (binary, or truncated by GitHub) still gets a card —
              // FileCard renders its own "no diff text" body.
              const prFile: PrFile = patchByPath.get(file.path) ?? {
                path: file.path,
                additions: file.additions,
                deletions: file.deletions,
                patch: null,
              };
              const annotations = annotationsFor(file.path, currentFindings);
              const open = openPaths?.[file.path] ?? false;

              return (
                <FileCard
                  key={file.path}
                  file={prFile}
                  {...(commenting ? { commenting } : {})}
                  annotations={annotations}
                  {...(onSelectFinding ? { onSelectFinding } : {})}
                  open={open}
                  onToggle={() =>
                    setOpenPaths((prev) => ({ ...prev, [file.path]: !(prev?.[file.path] ?? false) }))
                  }
                  headerExtra={
                    annotations.total > 0 ? (
                      <button
                        type="button"
                        style={s.findingsBtn}
                        title={t("smartDiff.jumpToFinding")}
                        onClick={(e) => {
                          // The card header is itself a click target — without
                          // this the badge would toggle the card closed again.
                          e.stopPropagation();
                          jumpToFirstFinding(file);
                        }}
                      >
                        <Icon.AlertOctagon size={12} aria-hidden="true" />
                        {t("smartDiff.findingsBadge", { count: annotations.total })}
                      </button>
                    ) : undefined
                  }
                />
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
