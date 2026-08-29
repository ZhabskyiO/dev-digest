import type { CSSProperties } from "react";

/** Co-located styles for ExportWizard. */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 20, padding: "20px 24px" } satisfies CSSProperties,
  stepIndicator: { marginBottom: 4 } satisfies CSSProperties,
  stepBody: { minHeight: 320 } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerRight: { marginLeft: "auto", display: "flex", gap: 10 } satisfies CSSProperties,
} as const;
