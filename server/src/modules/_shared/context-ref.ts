import { z } from 'zod';

/**
 * A clone-relative document path is attacker-influenced (it arrives as a
 * query param / body field, and drives filesystem reads downstream). This is
 * defence-in-depth #1: reject the obviously-hostile shapes at the schema
 * layer so they never reach a handler. The service's own `resolveInClone`
 * (realpath + prefix check) is defence-in-depth #2 for whatever slips past a
 * merely-textual check (e.g. a symlink).
 */
export const ContextPath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith('/'), 'path must not start with "/"')
  .refine((p) => !p.split('/').includes('..'), 'path must not contain ".."');

/**
 * A single `{repo_id, path}` project-context reference, built from
 * constrained primitives rather than the unrefined mirrored
 * `ProjectContextRef` contract shape (`repo_id: z.string()`, `path:
 * z.string()`, no constraints). Every write route that accepts
 * caller-supplied clone-relative refs must carry the same `ContextPath`
 * refinements (no leading "/", no "..") the read routes apply, plus a
 * `repo_id` shape narrow enough to fail schema validation (422) instead of
 * reaching a repository call with a non-UUID and failing there as a
 * Postgres 500.
 *
 * Shared between `modules/project-context/routes.ts` (`PUT /agents/:id/
 * context`) and `modules/skills/routes.ts` (`PUT /skills/:id`'s `context`
 * field) — both write routes persist the same shape via
 * `ProjectContextService.setAgentContext`/`setSkillContext`. Extracted here
 * (rather than duplicated, or imported module→module) mirroring
 * `_shared/net-guards.ts`'s precedent: `isDisallowedIp`/`looksLikeHtml` were
 * moved out of `modules/skills/helpers.ts` into `_shared` specifically so
 * `modules/reviews/intent/external.ts` could reuse them without a
 * `no-cross-module-internals` violation.
 */
export const ContextRefBody = z.object({ repo_id: z.string().uuid(), path: ContextPath });
