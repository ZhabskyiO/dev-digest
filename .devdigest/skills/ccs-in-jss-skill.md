# dev-digest-conventions

House conventions for `dev-digest`. Flag changes that violate any rule below and cite the offending `file:line`.

## annotate-css-js-style
Annotate CSS-in-JS style entries with `satisfies CSSProperties` to type-check style objects without widening the exported map.

Detected in `client/src/components/diff-viewer/comments.ts:110`:

```
rowWrap: { position: "relative" } satisfies CSSProperties,
```

[CORE ARCHITECTURAL RULES]:
1. PRAGMATIC RSC BOUNDARIES: Never place traditional runtime CSS-in-JS (styled-components, Emotion) inside a Server Component. If a component uses runtime styles, automatically inject the 'use client' directive at the absolute top of the file.
2. REGISTRY WRAPPERS: For App Router setups using runtime CSS-in-JS, always provide or assume the presence of a StyleRegistry wrapper inside `app/layout.tsx` to prevent flash of unstyled content (FOUC).
3. ZERO-RUNTIME PREFERENCE: If the user does not specify a library, favor zero-runtime or compile-time CSS-in-JS (like Vanilla Extract or Panda CSS) to preserve Server Component streaming benefits.

[CODE GENERATION REQUIREMENTS]:
- All code blocks must explicitly show file paths (e.g., `// app/components/Button.tsx`).
- Always separate logic from purely presentational styled primitives.
- When generating styled components, ensure TypeScript props are strongly typed.


it will be version 3