---
name: frontend-design
description: "Visual design & UX quality review for the DevDigest client (client/**). Reviews HOW the UI looks and behaves for the user — design-system discipline (@devdigest/ui usage), CSS-variable theming (dark/light), loading/empty/error states, accessibility, i18n coverage, and content resilience. Use when reviewing a PR or diff that touches client/ .tsx/.css files, when adding or restyling any UI component, or whenever someone asks 'does this look/behave right', mentions styling, colors, themes, badges, modals, a11y, or hardcoded text. NOT for file placement (frontend-architecture), hooks/state anti-patterns (react-best-practices), or RSC/data-fetching mechanics (next-best-practices)."
version: "1.0.0"
---

# Frontend Design & UX Review

Review the **user-facing quality** of client code: does it use the design system, respect both
themes, handle every UI state, stay accessible, and keep all text translatable. This skill covers
what the user *sees and experiences* — the neighbor skills cover where code lives and how React
is used.

## When this skill applies (vs. neighbors)

| Question | Skill |
|----------|-------|
| Does this UI use the design system / themes / states / a11y / i18n correctly? | **this skill** |
| Where does this component/hook/file go? | `frontend-architecture` |
| Is this hook usage / state pattern an anti-pattern? | `react-best-practices` |
| Server vs client component, data fetching, metadata | `next-best-practices` |
| How to test it | `react-testing-library` |

## Ground truth to load first

- `client/src/vendor/ui/README.md` — the design system's layers and rules.
- `client/src/vendor/ui/primitives/index.ts` + `kit/index.ts` — what already exists, so you
  recognize a hand-rolled duplicate on sight.
- `client/insights/` — known UI gotchas become extra review criteria.

The idiom here is **inline style objects referencing CSS variables** (`var(--accent)`,
`var(--text-muted)`, …) — feature components typically colocate them in a `styles.ts` next to
the component (`import { s } from "./styles"`). Not Tailwind utility classes, not hard-coded
colors. Judge new code against that idiom, not against generic React styling advice.

## Review dimensions

Review **added/modified lines only** — never flag legacy code the diff doesn't touch.

### 1. Design-system discipline

- Components come from `@devdigest/ui` — always via the barrel, never a deep import like
  `@devdigest/ui/primitives/Button`.
- A hand-rolled button, badge, modal, tab bar, input, skeleton, empty state, or spinner that
  duplicates an existing `@devdigest/ui` primitive/kit component is a finding: point at the
  existing component. New one-off UI is fine only when nothing in the library covers it.
- Severity/category rendering goes through `SeverityBadge` / `CategoryTag` — not by reading the
  `SEV`/`CAT` maps directly and definitely not by re-declaring severity colors locally.
- Icons come from the `Icon` registry (`icons.tsx`), not ad-hoc SVG or a direct `lucide-react`
  import in feature code.

### 2. Theming & tokens

- **No hard-coded colors** in feature code — no hex, `rgb()`, or named colors. Every color is a
  `var(--…)` token from `styles.css`. A hard-coded color is invisible breakage: it looks fine in
  the theme the author developed in and wrong in the other one.
- Same for one-off spacing/typography systems: match the surrounding scale (the library uses
  small px values and tokens like `--card-pad`), don't invent a parallel one.
- Anything that only reads correctly in dark *or* light (`data-theme` switch) is a finding —
  e.g. white text on `var(--bg-surface)`, shadows tuned to one background.

### 3. UI states

Every data-driven view needs all four states, and the library provides each one:

| State | Component |
|-------|-----------|
| Loading | `Skeleton` |
| Error | `ErrorState` |
| Empty (fetched, zero items) | `EmptyState` |
| Loaded | the actual UI |

- A component that renders TanStack Query data but only handles the happy path is a finding —
  the reviewer's job is to ask "what does the user see for the first 300 ms, on a 500, and with
  zero rows?"
- Actions that mutate need a pending treatment: `Button` has a `loading` prop — use it, and
  disable double-submit while pending.
- Empty ≠ loading: showing a skeleton forever when the list is legitimately empty (or flashing
  "no results" while still fetching) are both findings.

### 4. Accessibility

- Icon-only interactive elements (`IconBtn`, close ×, etc.) need an accessible name
  (`aria-label` or `title` per the component's API).
- Form controls are wrapped in `FormField` / kit inputs so labels are actually associated —
  a bare `<input>` with a nearby `<span>` label is a finding.
- Clickable `<div>`/`<span>` instead of `<button>`/`<a>` is a finding: no keyboard access, no
  focus, no semantics. The app is keyboard-driven (Cmd+K palette, `g`-then-key nav) — mouse-only
  UI breaks its core interaction model.
- Meaning must not ride on color alone — severity is color **plus** icon/label (which
  `SeverityBadge` already guarantees; hand-rolled color dots don't).
- Modals/drawers use the kit `Modal`/`Drawer` (focus trap, Esc) — not a positioned div.

### 5. i18n

- **Every user-facing string** goes through `next-intl` with a key in `messages/<locale>/*.json`.
  A hardcoded English string in JSX — including `aria-label`s, placeholders, empty-state copy,
  button labels, and toast text — is a finding. (Documented as "never" in `client/CLAUDE.md`.)
- Watch for strings smuggled in via props: `title="Delete"`, `placeholder="Search…"`.
- Concatenated fragments (`t('found') + count + t('items')`) break under translation — use ICU
  interpolation/plural in the message instead.

### 6. Content resilience

Review with hostile content in mind — this app renders repo paths, branch names, PR titles,
diff hunks, and LLM output:

- Long unbroken strings (file paths, URLs) need truncation or wrapping (`MonoLink` handles
  paths); otherwise they blow the layout open.
- Code/markdown from reviews renders through the `Markdown` primitive — not `dangerouslySetInnerHTML`.
- Lists that can be large need `overflow` handling inside their own container, and counts/plurals
  must survive 0, 1, and 10 000.

## Severity rubric

Match the pr-self-review scale — inflating design nits to CRITICAL erodes the gate:

- **CRITICAL** — user-visibly broken or violates a documented "never": hardcoded user-facing
  string (i18n rule in `client/CLAUDE.md`), `dangerouslySetInnerHTML` on untrusted content,
  interactive control unreachable by keyboard, a hand-rolled duplicate of a `@devdigest/ui`
  component wired into a shipped flow.
- **HIGH** — hard-coded color / theme-breaking style, missing error or loading state on a
  data-driven view, unlabeled icon-only control, deep import bypassing the barrel.
- **MEDIUM** — missing empty state, inconsistent spacing/typography vs. neighbors, missing
  truncation for long content, string concatenation in i18n, double-submit not guarded.

## Finding format

One line each, so findings merge cleanly into the pr-self-review report:

```
[SEVERITY] file.tsx:line — rule broken → concrete fix (name the @devdigest/ui component or token to use)
```

Always name the *existing* solution: "use `EmptyState`", "use `var(--text-muted)`",
"add key `pulls.empty` to `messages/en/pulls.json`". A design finding without a pointer to the
design system is just an opinion.
