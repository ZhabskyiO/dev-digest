# `@devdigest/web` — Next.js 15 studio

Package manager: **pnpm**. Dev `pnpm dev` (:3000) · `pnpm test` · `pnpm typecheck`.
`pnpm start` needs a prior `pnpm build` — for development always use `pnpm dev`.

## Layout

- `src/app/**/page.tsx` — App Router routes: `/`, `/onboarding`, `/repos/:repoId/pulls`,
  `/pulls/:number`, `/agents`, `/agents/:id`, `/settings/:section`
- `src/lib/api.ts` — the single fetch chokepoint; `src/lib/hooks/*` — TanStack Query hooks
- `src/components/app-shell` — nav, breadcrumbs, `g`-then-key shortcuts
- `src/vendor/ui` (`@devdigest/ui`) · `src/vendor/shared` (`@devdigest/shared`)

**Pages stay thin.** Feature logic lives in colocated `_components/<Name>/` folders,
each with its own `*.test.tsx` next to it.

## Conventions

- All server data goes through a hook in `src/lib/hooks/*` → `src/lib/api.ts`.
  Do not call `fetch` directly from a component.
- `src/vendor/**` is **vendored source, not dependencies** — but it is a copy.
  The canonical `shared` lives in `server/src/vendor/shared`; edit there and
  sync, don't fork the copy.
- Strings are i18n'd via `next-intl` — add keys to `messages/<locale>/*.json`,
  never hardcode user-facing text.
- API base is `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`).

## Testing

`pnpm test` = vitest + jsdom with `fetch` mocked — **no API and no browser
needed**. If a test wants a real stack it belongs in [`../e2e`](../e2e/README.md),
not here.

## Docs

UI route map + API surface per route: [README.md](README.md) (mermaid).
Cross-suite strategy: [../TESTING.md](../TESTING.md).
Learned the hard way: [insights.md](insights.md) · Reference: [docs/](docs/) ·
Planned work: [specs/](specs/).
