# Workflow Retro Ledger

One row per retro; compare runs over time.

| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
| 2026-08-27 | export-to-ci | 29 (26 top + 3 nested) | 265M cache-read → 157k out | 95.7% | 5.6h (≈2.7h active) | 0.66x wall / ≈1.4x active | ≈$85–103 (Sonnet 5, subagents only) | ban `git stash` in shared-worktree runs (Phase-1 revert incident cost 4 agents rework) |
