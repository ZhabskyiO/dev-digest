import type { IconName } from "@devdigest/ui";
import type { Verdict } from "@devdigest/shared";

/**
 * Per-verdict icon + accent for the brief's verdict block. Keyed by `Verdict`
 * directly (`request_changes` / `approve` / `comment`) — the same three
 * strings the `verdict.<value>` translation keys use, so there is no
 * separate labelKey indirection to drift out of sync (compare
 * `VerdictBanner/constants.ts`'s older `labelKey` pattern in `prReview`,
 * which predates this flatter `brief.verdict.<value>` shape).
 */
export const VERDICT_META: Record<Verdict, { c: string; bg: string; icon: IconName }> = {
  request_changes: { c: "var(--crit)", bg: "var(--crit-bg)", icon: "XCircle" },
  approve: { c: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
  comment: { c: "var(--info)", bg: "var(--info-bg)", icon: "MessageSquare" },
};
