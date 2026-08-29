# Workflow retro ledger

One row per retro (`/workflow-retro`), newest last, so runs can be compared over time.

| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
| 2026-08-27 | multi-agent-review-feature | 29 sub (26 tasks + 3 429-killed retries) + orchestrator | 5.3k→202k sub (+307M cache-read) · 0.5k→474k orch | 96.1% | 5h42m (≈2h50m active; ~2h55m session-limit outage) | 1.35x (active wall) | $301.30 ($173.15 sub + $128.15 orch) | pin sonnet on pr-self-review bucket subagents (they inherited fable-5: $56.77 → ≈$11) |
