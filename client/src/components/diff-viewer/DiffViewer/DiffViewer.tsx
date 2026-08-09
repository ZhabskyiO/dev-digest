/* DiffViewer — basic GitHub-style unified diff viewer. Renders real PrFile.patch
   (unified-diff text from the F1 API) as a list of collapsible FileCards.
   Optional inline comments (Files changed tab): hover a line → "+" → comment,
   posted live to GitHub; existing GitHub review comments render inline.
   Optional review findings: severity badges on the lines they cite. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@/lib/types";
import { type DiffCommentApi } from "../comments";
import { annotationsFor, type LineFinding } from "../annotations";
import { s } from "../styles";
import { FileCard } from "../FileCard";

export function DiffViewer({
  files,
  commenting,
  findings,
  onSelectFinding,
}: {
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** Review findings for the whole PR; bucketed per file here. Omit for a
   *  plain diff with no badges. */
  findings?: readonly FindingRecord[];
  onSelectFinding?: (finding: LineFinding) => void;
}) {
  const t = useTranslations("shell");
  if (!files || files.length === 0) {
    return <div style={s.empty}>{t("diffViewer.noChangedFiles")}</div>;
  }
  return (
    <div style={s.list}>
      {files.map((f, i) => (
        <FileCard
          key={i}
          file={f}
          commenting={commenting}
          {...(findings ? { annotations: annotationsFor(f.path, findings) } : {})}
          {...(onSelectFinding ? { onSelectFinding } : {})}
        />
      ))}
    </div>
  );
}
