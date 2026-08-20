/* DriftCompare — the drift detail view for one changed-since-attached document
   (AC-38): a line-level comparison between the content recorded at attach
   time and the document's current content, plus a Confirm action that never
   blocks even when the earlier version is unavailable (force-push, GC). */
"use client";

import { useTranslations } from "next-intl";
import { Button } from "@devdigest/ui";
import { diffLines } from "./helpers";
import { s } from "./styles";

export function DriftCompare({
  previous,
  current,
  previousUnavailable,
  onConfirm,
  confirming,
}: {
  /** The document's content at the recorded attach-time revision — absent
   *  when that revision is no longer resolvable in the clone (AC-38). */
  previous?: string;
  current: string;
  previousUnavailable: boolean;
  /** Present when the caller wants a Confirm button rendered inline. */
  onConfirm?: () => void;
  confirming?: boolean;
}) {
  const t = useTranslations("context");
  const lines = previousUnavailable || previous == null ? null : diffLines(previous, current);

  return (
    <div style={s.wrap}>
      {previousUnavailable && <div style={s.note}>{t("drift.detail.previousUnavailable")}</div>}
      <div style={s.lines}>
        {lines
          ? lines.map((line, i) => (
              <div key={i} style={s.lineFor(line.type)}>
                <span className="mono" style={s.signFor(line.type)}>
                  {line.type === "added" ? "+" : line.type === "removed" ? "−" : ""}
                </span>
                <span className="mono" style={s.text}>
                  {line.text || " "}
                </span>
              </div>
            ))
          : current.split("\n").map((text, i) => (
              <div key={i} style={s.lineFor("context")}>
                <span className="mono" style={s.signFor("context")} />
                <span className="mono" style={s.text}>
                  {text || " "}
                </span>
              </div>
            ))}
      </div>
      {onConfirm && (
        <div style={s.actions}>
          <Button kind="primary" onClick={onConfirm} loading={confirming}>
            {confirming ? t("drift.detail.confirming") : t("drift.detail.confirm")}
          </Button>
        </div>
      )}
    </div>
  );
}
