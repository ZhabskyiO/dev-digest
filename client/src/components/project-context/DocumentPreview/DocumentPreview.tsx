/* DocumentPreview — the read-only rendering of one document's markdown body
   (AC-10), shared by the Project Context page and any "Preview" affordance
   on an attachment row.

   Untrusted content (Untrusted inputs, spec): `body` is third-party Markdown
   from the target repository. `@devdigest/ui`'s `Markdown` renders it via
   `react-markdown` + `remark-gfm` WITHOUT `rehype-raw`, so embedded HTML
   (`<script>`, `<img onerror=…>`, …) is rendered as inert text, never parsed
   into real DOM nodes or executed — do not add `rehype-raw` here. No `Edit`
   affordance exists on this component; Non-goal per the spec's page scope. */
"use client";

import { useTranslations } from "next-intl";
import { Markdown } from "@devdigest/ui";
import { s } from "./styles";

export function DocumentPreview({
  path,
  body,
  tokens,
  truncated,
  usedByAgents,
}: {
  path: string;
  body: string;
  /** Token estimate (AC-9) — omitted when the caller has none to show. */
  tokens?: number;
  /** Set when `body` was cut to the configured preview cap (AC-10, AC-24). */
  truncated?: boolean;
  /** How many agents currently have this document attached (AC-11). */
  usedByAgents?: number;
}) {
  const t = useTranslations("context");
  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <span className="mono" style={s.path}>
          {path}
        </span>
        <div style={s.meta}>
          {tokens != null && <span className="tnum">{t("tokens.approx", { count: tokens })}</span>}
          {usedByAgents != null && <span>{t("attachments.usedByAgents", { count: usedByAgents })}</span>}
        </div>
      </div>
      {truncated && <div style={s.note}>{t("preview.truncatedNote")}</div>}
      <div style={s.body}>
        <Markdown>{body}</Markdown>
      </div>
    </div>
  );
}
