# mcp-server Gotchas

Known quirks, dead ends, and error → cause → fix records. Specific and actionable —
pass the cold-read test.
See also: `insights/INSIGHTS.md` for what works and why it is built this way.

---

## What Doesn't Work

2026-06-26 — `console.log` anywhere under `src/` corrupts the MCP stdio transport (stdout is the JSON-RPC channel). ALL output must go through `log.*` which routes to `console.error` (stderr). ref: mcp-server/src/log.ts:1

## Tool & Library Notes

2026-06-26 — pnpm install warns about `esbuild` build scripts being ignored — benign, esbuild is a transitive dep of tsx; approve with `pnpm approve-builds` if needed. ref: mcp-server/package.json

## Recurring Errors & Fixes

2026-06-26 — `noUncheckedIndexedAccess` in tsconfig requires guarding array[0] even after a `.length === 1` check — TypeScript still types it as `T | undefined`. Pattern: `const match = matches[0]; if (!match) return { error: ... }; return { repoId: match.id }`. ref: mcp-server/src/core/resolve.ts:54
