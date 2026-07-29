# Entry examples — the quality bar

## Contents

- The one test that decides everything
- Vague vs useful
- The gold standard
- Worked examples from this repo
- Corrections, not rewrites
- What never gets an entry

## The one test that decides everything

> **"If this would be obvious to anyone reading the code — don't write it."**

An entry earns its place only if a future session would get something *wrong*
without it.

## Vague vs useful

An entry must be actionable **cold**: read with zero conversation context, the
reader knows exactly what to do.

| ❌ Vague — noise | ✅ Useful — actionable |
|---|---|
| "Promises can be tricky" | "`Promise.all()` on the ingest pipeline times out past 30 items — use `Promise.allSettled()` in batches of 10" |
| "be careful with async" | "checkout-flow state always goes through Zustand (`cartStore.ts`); 3 components share the cart, local state breaks it" |
| "watch out for the DB" | "the `subscriptions` table is append-only — the row you want is the highest `version`, not the newest `created_at`" |

The left column is a feeling. The right column is a decision someone can act on.

## The gold standard

Anthropic's own guidance on high-signal skill content singles out the "Gotchas"
pattern, and this is the shape it takes:

> The `subscriptions` table is append-only. The row you want is the one with the
> highest version, not the most recent `created_at`.

Note what it does: names the exact object, states the trap, gives the correct
action. No narrative, no hedging, no history.

## Abstract, don't narrate

Record the reusable rule, not the story of how it was found.

❌ **Narrative** — "Spent an hour on a failing typecheck, tried reinstalling
server deps, eventually realised reviewer-core wasn't installed."

✅ **Abstracted** — "`server` type-checks reviewer-core's raw source via a
tsconfig alias, so `reviewer-core` needs its own `pnpm install` — `server`'s
install never touches it. Symptom: `TS2307` on `@devdigest/reviewer-core`."

## Worked examples from this repo

Real entries, in the target format, showing which section each belongs to:

```markdown
## Tool & Library Notes
- 2026-07-27 — ALWAYS `nvm use` before any client/server command. `.nvmrc` is 22;
  Next.js hard-refuses to boot on Node < 18.18 and the error names the version.

## Recurring Errors & Fixes
- 2026-07-28 — `TS2307: Cannot find module '@devdigest/reviewer-core'` in `server`
  means reviewer-core's deps are missing, not server's. Fix:
  `cd reviewer-core && pnpm install`. Cause: `server/tsconfig.json` aliases the
  package to `../reviewer-core/src`, so its `openai`/`zod` must resolve there.

## Codebase Patterns
- 2026-07-28 — All four packages use pnpm with their own lockfile; there is no
  workspace linking them. `reviewer-core/.npmrc` needs `node-linker=hoisted`
  because `server` resolves into its `node_modules`.

## What Doesn't Work
- 2026-07-27 — NEVER `docker compose down -v` to reset the dev DB. `-v` drops the
  `devdigest_pgdata` volume with every imported repo and review. Use `down`.
```

Note `NEVER` / `ALWAYS` on the two hard constraints — absolute directives survive
skimming in a way soft phrasing does not.

## Corrections, not rewrites

When new information refines an existing entry, **append a dated note beneath
it**. The original line is never edited, moved, or deleted.

```markdown
## Tool & Library Notes
- 2026-07-28 — reviewer-core needs its own `pnpm install`; `server`'s does not
  cover it.
  └ 2026-08-02 correction: also required before `pnpm test`, not just
    `pnpm typecheck` — the runtime import fails the same way.
```

If two entries end up contradicting each other, **flag both to the human**. Never
resolve a contradiction by deleting one.

## What never gets an entry

- General programming knowledge (how `async`/`await` works, what a JOIN is).
- Anything already stated in `README.md`, `CLAUDE.md`, or `TESTING.md`.
- Anything plainly visible in the code being described.
- One-off incidents with no reusable rule behind them.
- Restatements of an entry that already exists — check with `list-entries.sh`
  first.

When nothing clears the bar, **writing nothing is the correct outcome.**
