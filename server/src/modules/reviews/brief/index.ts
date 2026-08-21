/**
 * Brief module barrel — the facade `modules/reviews/routes.ts` (T13) reaches
 * through. Mirrors `modules/repo-intel/index.ts`'s shape: the pure helpers
 * (`compose.ts`, `summaries.ts`) and the repository (`repository.ts`) stay
 * internal to this module — only `BriefService` is a public entry point.
 */
export { BriefService } from './service.js';
