import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  CiExportInput,
  CiPreview,
  CiExport,
  CiInstallation,
  CiInstallationStatus,
  CiRunList,
  CiRunsQuery,
  CiTarget,
  CiPostAs,
  CiTrigger,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';
import { CiIngestService } from './ingest.js';

/**
 * T13 — Export-to-CI's transport layer. Pure wiring: Zod `params`/`body`/
 * `querystring`/`response` schemas → `getContext` → one `CiService`/
 * `CiIngestService` call → return. No business logic here (target/repo-shape
 * validation, the conflict check, the GitHub-error wrap all live in
 * `CiService`/`CiIngestService`, T10/T11).
 *
 * Error → status mapping is NOT duplicated here: `app.ts`'s global error
 * handler already maps `ValidationError` → 422 (unsupported target, bad
 * `owner/name` shape, invalid `workflow_override` YAML — all thrown by
 * `CiService`/`workflow.ts`), the `ci_repo_conflict` `AppError` → 409
 * (`CiService.assertNoConflict`), and `ExternalServiceError` → 502 with the
 * repo name + sanitized reason baked into the message
 * (`CiService.wrapGithubError`).
 *
 *   POST /agents/:id/ci-preview      → Step 2 preview, zero side effects
 *   POST /agents/:id/export-ci       → Step 4 "open a PR"
 *   POST /agents/:id/ci-archive      → Step 4 "download" (zip, zero side effects)
 *   POST /agents/:id/ci-installations → explicit post-download confirmation
 *   GET  /agents/:id/ci-installations → per-installation status (CI tab)
 *   GET  /ci-runs                    → paginated/filtered CI Runs list
 *   POST /ci-runs/refresh            → ingest fresh GitHub Actions runs, then list
 */

/** Body for `POST /agents/:id/ci-installations` — the download path's explicit
 *  confirmation (`CiService.ConfirmInstallationInput`). Not a `@devdigest/shared`
 *  contract: this shape only makes sense post-download (no `action`/
 *  `workflow_override`), so it is defined locally rather than importing the
 *  service's TS-only interface into a Zod schema. */
const ConfirmInstallationBody = z.object({
  repo: z.string().min(1),
  target: CiTarget,
  base: z.string().min(1),
  post_as: CiPostAs,
  triggers: z.array(CiTrigger).min(1),
});

/** `GET /ci-runs?limit=&offset=` — query values arrive as strings; `CiRunsQuery`
 *  itself declares `limit`/`offset` as plain numbers (the persisted/API shape),
 *  so the querystring copy adds `z.coerce.number()` the same way
 *  `AgentStatsQuery`/`VersionParams` do for their own numeric query/param
 *  fields — the parsed result still satisfies `CiRunsQuery`. Bounds are
 *  clamped at THIS route-level schema (never the shared contract, which also
 *  describes the persisted/API shape elsewhere): an unbounded `offset`
 *  (e.g. `-1`) reaches Drizzle and surfaces as a raw Postgres 500 instead of a
 *  422, and an unbounded `limit` (e.g. `100000000`) allows an unbounded
 *  fetch. */
const CiRunsQuerystring = CiRunsQuery.extend({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Body for `POST /ci-runs/refresh` — deliberately nullish at the TOP level
 *  (not just its one field): `apiFetch` only sets a JSON content-type when a
 *  body is actually sent, so a caller that POSTs with no payload arrives with
 *  `req.body === undefined` and no content-type at all, while a client that
 *  sends `content-type: application/json` with a literal `null` body (curl
 *  `-d null`, or a stringified absent payload) arrives as `req.body === null`.
 *  `.nullish()` accepts no-body, null-body, and the `{ agent_id }`-narrowed
 *  refresh call; a required `body` schema would reject the first two. */
const RefreshBody = z.object({ agent_id: z.string().optional() }).nullish();

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/agents/:id/ci-preview',
    { schema: { params: IdParams, body: CiExportInput, response: { 200: CiPreview } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.preview(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/export-ci',
    { schema: { params: IdParams, body: CiExportInput, response: { 200: CiExport } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.exportToCi(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/ci-archive',
    {
      schema: {
        params: IdParams,
        body: CiExportInput,
        response: { 200: z.object({ filename: z.string(), content_base64: z.string() }) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.archive(workspaceId, req.params.id, req.body);
    },
  );

  app.post(
    '/agents/:id/ci-installations',
    {
      schema: { params: IdParams, body: ConfirmInstallationBody, response: { 200: CiInstallation } },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.confirmInstallation(workspaceId, req.params.id, req.body);
    },
  );

  app.get(
    '/agents/:id/ci-installations',
    { schema: { params: IdParams, response: { 200: z.array(CiInstallationStatus) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new CiService(app.container);
      return service.installationStatuses(workspaceId, req.params.id);
    },
  );

  app.get(
    '/ci-runs',
    { schema: { querystring: CiRunsQuerystring, response: { 200: CiRunList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const ingest = new CiIngestService(app.container);
      return ingest.list(workspaceId, req.query);
    },
  );

  app.post(
    '/ci-runs/refresh',
    { schema: { body: RefreshBody, response: { 200: CiRunList } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const ingest = new CiIngestService(app.container);
      return ingest.refresh(workspaceId, { agentId: req.body?.agent_id });
    },
  );
}
