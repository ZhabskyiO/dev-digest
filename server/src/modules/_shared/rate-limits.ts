/**
 * Shared per-route rate-limit configs. Extracted so the "run a review"
 * fence stays a single source of truth across every route that fans out to
 * an LLM run — a single-agent review (`POST /pulls/:id/review`) and a
 * multi-agent run (`POST /pulls/:id/multi-agent-run`) previously each
 * hard-coded the identical `{ max: 10, timeWindow: '1 minute' }` literal,
 * which could silently drift if only one was ever tuned (Rec-6).
 *
 * NOTE: `@fastify/rate-limit` is not registered at all when
 * `config.nodeEnv === 'test'` (`app.ts`), so this constant's VALUE is what a
 * test can assert against — never expect a 429 from `app.inject`.
 */
export const RUN_TRIGGER_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
