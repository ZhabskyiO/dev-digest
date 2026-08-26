/* FindingsPanel — hide-low-confidence + j/k navigation + FindingCard list,
   wiring the accept/dismiss action hook (A2). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Toggle, EmptyState, Icon, SEV } from "@devdigest/ui";
import type { FindingRecord } from "@devdigest/shared";
import { FindingCard } from "../FindingCard";
import { useFindingAction } from "../../../../../../../lib/hooks/reviews";
import { useEvalCaseSeed } from "../../../../../../../lib/hooks/evals";
import { CaseEditorModal } from "@/components/eval-case-editor";
import type { EvalCaseSeed } from "@devdigest/shared";
import { notify } from "../../../../../../../lib/toast";
import { TALLY_SEVERITIES, tallySeverities, type TallySeverity } from "@/components/findings-summary";
import { KEY_TO_ACTION, SCROLL_SETTLE_MS } from "./constants";
import { visibleFindings } from "./helpers";
import { s } from "./styles";

export function FindingsPanel({
  findings,
  prId,
  repoFullName,
  headSha,
  targetFindingId = null,
}: {
  findings: FindingRecord[];
  prId: string;
  repoFullName?: string | null;
  headSha?: string | null;
  /** A finding to reveal (from `?finding=`), already narrowed by the accordion
   *  to the one run that contains it. */
  targetFindingId?: string | null;
}) {
  const t = useTranslations("prReview");
  const action = useFindingAction();
  const evalSeed = useEvalCaseSeed();
  const [caseSeed, setCaseSeed] = React.useState<EvalCaseSeed | null>(null);
  const [hideLow, setHideLow] = React.useState(false);
  const [focusIdx, setFocusIdx] = React.useState(0);

  const shown = React.useMemo(() => visibleFindings(findings, hideLow), [findings, hideLow]);

  /* Counts describe the list DIRECTLY BELOW them, not the whole run — so
     toggling "hide low confidence" moves them. With the toggle off (the
     default) they match the accordion header's tally exactly. */
  const counts = React.useMemo(() => tallySeverities(shown), [shown]);

  /* Reveal the targeted finding: focus its card and scroll to it.
     `hideLow` is cleared first when the target is filtered out — arriving from
     a diff badge only to find nothing would read as a broken link, and the
     reviewer explicitly asked for THIS finding. The effect re-runs after the
     toggle because `shown` is a dependency. */
  React.useEffect(() => {
    if (!targetFindingId) return;
    const index = shown.findIndex((f) => f.id === targetFindingId);
    if (index === -1) {
      if (hideLow && findings.some((f) => f.id === targetFindingId)) setHideLow(false);
      return;
    }
    setFocusIdx(index);

    /* Instant, not smooth, and re-asserted for a short window: on a cold load
       of `?finding=…` the Timeline query resolves after this panel renders and
       inserts a tall block above the card, so a single scroll lands and is then
       pushed away. Comparing the card's own top between frames re-centres it
       only when something actually moved it — with `behavior: "smooth"` the
       position changes every frame and this could never tell drift from its
       own animation. Any deliberate scroll or keypress ends it, so the reader
       is never fought for the whole window. */
    let raf = 0;
    let lastTop = Number.NaN;
    const deadline = Date.now() + SCROLL_SETTLE_MS;
    let cancelled = false;
    const stop = () => {
      cancelled = true;
    };

    const keepCentred = () => {
      if (cancelled) return;
      const el = document.querySelector(`[data-finding-id="${targetFindingId}"]`);
      if (el) {
        const top = el.getBoundingClientRect().top;
        if (Number.isNaN(lastTop) || Math.abs(top - lastTop) > 1) {
          el.scrollIntoView({ block: "center" });
          lastTop = el.getBoundingClientRect().top;
        }
      }
      if (Date.now() < deadline) raf = requestAnimationFrame(keepCentred);
    };
    raf = requestAnimationFrame(keepCentred);

    window.addEventListener("wheel", stop, { passive: true, once: true });
    window.addEventListener("touchstart", stop, { passive: true, once: true });
    window.addEventListener("keydown", stop, { once: true });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [targetFindingId, shown, hideLow, findings]);

  /* Chip click → walk that severity's findings. The list is severity-sorted,
     so a severity occupies one contiguous block: taking the first card BELOW
     the current focus and wrapping at the end of the block means repeated
     clicks tour the group instead of pinning the reader to its first card. */
  const jumpToSeverity = React.useCallback(
    (sev: TallySeverity) => {
      const indices: number[] = [];
      shown.forEach((f, i) => {
        if (f.severity === sev) indices.push(i);
      });
      const next = indices.find((i) => i > focusIdx) ?? indices[0];
      if (next === undefined) return;
      setFocusIdx(next);
      const id = shown[next]?.id;
      const el = id ? document.querySelector(`[data-finding-id="${id}"]`) : null;
      // Smooth here, unlike the deep-link scroll above: this one follows a
      // click on a card already on screen, with no late query to fight.
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    },
    [shown, focusIdx],
  );

  // j/k navigation + a/d shortcuts on the focused finding (keyboard).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "j") setFocusIdx((i) => Math.min(i + 1, shown.length - 1));
      else if (e.key === "k") setFocusIdx((i) => Math.max(i - 1, 0));
      else if (KEY_TO_ACTION[e.key] && shown[focusIdx]) {
        action.mutate({ findingId: shown[focusIdx]!.id, action: KEY_TO_ACTION[e.key]!, prId });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shown, focusIdx, action, prId]);

  return (
    <div>
      <div style={s.toolbar}>
        {TALLY_SEVERITIES.map((sev) => {
          const count = counts[sev];
          if (count === 0) return null;
          // A run with no criticals should not have to say "0 Critical" — the
          // absent chip is the message.
          const SevIcon = Icon[SEV[sev].icon];
          return (
            <button
              key={sev}
              type="button"
              style={s.sevChip}
              title={t("panel.jumpToSeverity", { severity: SEV[sev].label.toLowerCase() })}
              onClick={() => jumpToSeverity(sev)}
            >
              <SevIcon size={13} style={{ color: SEV[sev].c, flexShrink: 0 }} aria-hidden="true" />
              {count} {SEV[sev].label}
            </button>
          );
        })}
        {shown.length > 0 && <span style={s.divider} aria-hidden="true" />}

        <div style={s.toggleGroup}>
          {t("panel.hideLowConfidence")}
          <Toggle on={hideLow} onChange={setHideLow} size={16} />
        </div>
      </div>

      <div style={s.list}>
        {shown.length === 0 ? (
          <EmptyState icon="Filter" title={t("panel.noMatchTitle")} body={t("panel.noMatchBody")} />
        ) : (
          shown.map((f, i) => (
            <FindingCard
              key={f.id}
              f={f}
              focused={i === focusIdx}
              defaultExpanded={i === 0}
              expanded={f.id === targetFindingId ? true : undefined}
              pending={action.isPending}
              repoFullName={repoFullName}
              headSha={headSha}
              onAction={(act) => action.mutate({ findingId: f.id, action: act, prId })}
              evalPending={evalSeed.isPending}
              onEvalCase={() =>
                evalSeed.mutate(
                  { findingId: f.id },
                  {
                    onSuccess: (seed) => {
                      if (seed.existing_case_id) {
                        notify.info(t("panel.evalCaseExists", { name: seed.name }));
                      }
                      setCaseSeed(seed);
                    },
                    onError: (e) =>
                      notify.error(
                        t("panel.evalCaseFailed", {
                          message: e instanceof Error ? e.message : String(e),
                        }),
                      ),
                  },
                )
              }
            />
          ))
        )}
      </div>
      {caseSeed && (
        <CaseEditorModal
          owner={{ kind: "agent", id: caseSeed.agent_id, name: caseSeed.agent_name }}
          existing={null}
          seed={caseSeed}
          onClose={() => setCaseSeed(null)}
        />
      )}
    </div>
  );
}
