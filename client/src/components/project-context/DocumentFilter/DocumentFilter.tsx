/* DocumentFilter — the "Filter documents…" text field above an AttachmentList
   (AC-18). Purely visual narrowing: it never touches the attachment set, so a
   consumer filters its own `items` array by this value before handing it to
   `AttachmentList` — clearing the filter must show every row, checked state
   intact, which only holds if this component owns no selection state itself. */
"use client";

import { useTranslations } from "next-intl";
import { Icon, TextInput } from "@devdigest/ui";

export function DocumentFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("context");
  return (
    <TextInput
      value={value}
      onChange={onChange}
      placeholder={t("filter.placeholder")}
      suffix={<Icon.Filter size={14} style={{ color: "var(--text-muted)" }} />}
      aria-label={t("filter.placeholder")}
    />
  );
}
