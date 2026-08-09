/* CodeLine — one rendered diff line: gutter number, +/- sign, text, plus the
   hover "+" affordance, any anchored comment threads, and an inline composer. */
"use client";

import React from "react";
import { SeverityBadge } from "@devdigest/ui";
import { commentTargetFor, type CommentThread, type DiffCommentApi, cs } from "../comments";
import { diffLineAnchorId, type LineFinding } from "../annotations";
import { type Line } from "../helpers";
import { s, lineRowFor, lineSignFor } from "../styles";
import { CommentThreadView } from "../CommentThreadView";
import { InlineComposer } from "../InlineComposer";

export function CodeLine({
  ln,
  path,
  threads,
  commenting,
  findings,
  onSelectFinding,
}: {
  ln: Line;
  path: string;
  threads: CommentThread[];
  commenting?: DiffCommentApi;
  /** Review findings anchored to this line — badges + the scroll target. */
  findings?: LineFinding[];
  /** Makes each severity badge a button that opens the finding in full.
   *  Omitted ⇒ the badges render as plain, non-interactive labels. */
  onSelectFinding?: (finding: LineFinding) => void;
}) {
  const [hover, setHover] = React.useState(false);
  const [composing, setComposing] = React.useState(false);

  if (ln.kind === "hunk") {
    return (
      <div className="mono" style={s.hunk}>
        {ln.text}
      </div>
    );
  }

  const sign = ln.kind === "add" ? "+" : ln.kind === "del" ? "−" : "";
  const target = commenting?.canComment ? commentTargetFor(ln) : null;
  const showAdd = hover && !!target && !composing;
  const flagged = (findings?.length ?? 0) > 0;

  return (
    <div
      style={cs.rowWrap}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        /* The anchor sits on the NEW line number, which is what a finding's
           `start_line` cites — deleted lines are never finding targets. */
        {...(ln.newNo != null ? { id: diffLineAnchorId(path, ln.newNo) } : {})}
        style={flagged ? { ...lineRowFor(ln.kind), ...s.flaggedRow } : lineRowFor(ln.kind)}
      >
        <span className="mono tnum" style={{ ...s.lineNo, position: "relative" }}>
          {showAdd && target && (
            <button
              type="button"
              title="Add a comment on this line"
              aria-label="Add a comment on this line"
              onClick={() => setComposing(true)}
              style={cs.addBtn}
            >
              +
            </button>
          )}
          {ln.newNo ?? ln.oldNo ?? ""}
        </span>
        <span className="mono" style={lineSignFor(ln.kind)}>
          {sign}
        </span>
        <span className="mono" style={s.lineText}>
          {ln.text || " "}
        </span>
        {flagged && (
          <span style={s.lineFindings}>
            {findings!.map((f) =>
              onSelectFinding ? (
                /* A real <button>, not a clickable span: this is a navigation
                   control (it leaves the diff for the finding in full), so it
                   must be tabbable and operable from the keyboard. */
                <button
                  key={f.id}
                  type="button"
                  title={f.title}
                  onClick={() => onSelectFinding(f)}
                  style={s.lineFindingBtn}
                >
                  <SeverityBadge severity={f.severity} />
                </button>
              ) : (
                <span key={f.id} title={f.title}>
                  <SeverityBadge severity={f.severity} />
                </span>
              ),
            )}
          </span>
        )}
      </div>

      {commenting &&
        commenting.showComments &&
        threads.map((th) => (
          <CommentThreadView key={th.rootId} thread={th} commenting={commenting} path={path} />
        ))}

      {commenting && composing && target && (
        <InlineComposer
          commenting={commenting}
          path={path}
          line={target.line}
          side={target.side}
          onClose={() => setComposing(false)}
        />
      )}
    </div>
  );
}
