/* DriftBadge — marks a document as changed-since-attached (AC-36) wherever it
   is listed: the Project Context page, the agent Context tab, and the skill's
   attachment section. Icon + text, never colour alone. Optionally clickable to
   open the drift detail (`DriftCompare`) — plain when `onClick` is omitted. */
"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@devdigest/ui";

export function DriftBadge({ onClick }: { onClick?: () => void }) {
  const t = useTranslations("context");
  const badge = (
    <Badge color="var(--warn)" bg="var(--warn-bg)" icon="AlertTriangle">
      {t("drift.badge")}
    </Badge>
  );
  if (!onClick) return badge;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("drift.viewChange")}
      style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "inline-flex" }}
    >
      {badge}
    </button>
  );
}
