import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * Conventions module end-to-end: extraction grounds candidates against real
 * files on disk, review decisions stick, and accepted candidates become a skill
 * that can be attached to an agent.
 */
d('conventions routes', () => {
  let pg: PgFixture;
  let clonePath: string;
  let repoId: string;

  const SAMPLED = ['src/user.ts', 'src/order.ts'];

  /** One real proposal, one citing a file that was never sampled. */
  const extraction = {
    conventions: [
      {
        category: 'typing',
        rule: 'Validate request payloads with a zod schema.',
        evidence_path: 'src/user.ts',
        evidence_line: 3,
        evidence_snippet: 'export const UserSchema = z.object({',
        confidence: 0.9,
      },
      {
        category: 'error-handling',
        rule: 'Wrap handlers in a Result type.',
        evidence_path: 'src/user.ts',
        evidence_line: 4,
        evidence_snippet: 'return Result.wrap(handler);',
        confidence: 0.8,
      },
      {
        category: 'naming',
        rule: 'Name repository methods findBy*.',
        evidence_path: 'src/ghost.ts',
        evidence_line: 1,
        evidence_snippet: 'findByEmail()',
        confidence: 0.7,
      },
    ],
  };

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);

    clonePath = await mkdtemp(join(tmpdir(), 'dd-conventions-'));
    await mkdir(join(clonePath, 'src'), { recursive: true });
    await writeFile(
      join(clonePath, 'src/user.ts'),
      [
        'import { z } from "zod";',
        '',
        'export const UserSchema = z.object({',
        '  id: z.string().uuid(),',
        '});',
      ].join('\n'),
    );
    await writeFile(
      join(clonePath, 'src/order.ts'),
      ['import { z } from "zod";', '', 'export const OrderSchema = z.object({});'].join('\n'),
    );
    await writeFile(join(clonePath, 'package.json'), '{ "name": "fixture" }');

    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    repoId = repo!.id;
    await pg.handle.db
      .update(t.repos)
      .set({ clonePath })
      .where(eq(t.repos.id, repoId));
  });

  afterAll(async () => {
    await pg?.stop();
  });

  /** `sampled` lets a test simulate an unindexed repo by returning no files. */
  function makeApp(sampled: string[] = SAMPLED) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const repoIntel = {
      getConventionSamples: async () => sampled,
    } as unknown as RepoIntel;
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        repoIntel,
        llm: {
          openai: new MockLLMProvider('openai', {
            structuredBySchema: { ConventionExtraction: extraction },
          }),
        },
      },
    });
  }

  async function extract(sampled?: string[]) {
    const app = await makeApp(sampled);
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    await app.close();
    return res;
  }

  it('keeps only candidates whose evidence exists in the sampled files', async () => {
    const res = await extract();
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // 1 of 3 survives: one snippet is absent from the file it cites, one file
    // was never sampled at all.
    expect(body.candidates).toHaveLength(1);
    expect(body.dropped).toBe(2);
    expect(body.sampled_files).toEqual(SAMPLED);
    expect(body.candidates[0]).toMatchObject({
      rule: 'Validate request payloads with a zod schema.',
      category: 'typing',
      evidence_path: 'src/user.ts',
      evidence_line: 3,
      evidence_snippet: 'export const UserSchema = z.object({',
      status: 'pending',
      accepted: false,
      skill_id: null,
    });
  });

  it('re-scanning does not duplicate an already-known rule', async () => {
    const res = await extract();
    const body = res.json();
    expect(body.candidates).toHaveLength(1);
    expect(body.duplicates).toBe(1);
  });

  it('reports degraded instead of guessing when the repo is not indexed', async () => {
    const res = await extract([]);
    const body = res.json();
    expect(body.degraded).toBe(true);
    expect(body.reason).toBe('not_indexed');
    expect(body.sampled_files).toEqual([]);
    // The already-stored candidate is still returned, not wiped.
    expect(body.candidates).toHaveLength(1);
  });

  it('rejects a candidate and keeps it out of the next scan', async () => {
    const app = await makeApp();
    const list = (await app.inject({ url: `/repos/${repoId}/conventions` })).json();
    const id = list[0].id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/conventions/${id}`,
      payload: { status: 'rejected' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ status: 'rejected', accepted: false });

    const pending = (
      await app.inject({ url: `/repos/${repoId}/conventions?status=pending` })
    ).json();
    expect(pending).toHaveLength(0);
    await app.close();

    // A rejected rule is a known rule — the next scan must not re-propose it.
    const rescan = (await extract()).json();
    expect(rescan.duplicates).toBe(1);
    expect(rescan.candidates).toHaveLength(1);
    expect(rescan.candidates[0].status).toBe('rejected');
  });

  it('editing a rule re-derives its dedupe key', async () => {
    const app = await makeApp();
    const list = (await app.inject({ url: `/repos/${repoId}/conventions` })).json();
    const id = list[0].id;

    await app.inject({
      method: 'PATCH',
      url: `/conventions/${id}`,
      payload: { status: 'pending', rule: 'Validate payloads with zod at the route edge.' },
    });
    await app.close();

    const [row] = await pg.handle.db
      .select()
      .from(t.conventions)
      .where(eq(t.conventions.id, id));
    expect(row!.rule).toBe('Validate payloads with zod at the route edge.');
    expect(row!.ruleKey).toBe('validate payloads with zod at the route edge');
  });

  it('404s on a convention from another workspace', async () => {
    const app = await makeApp();
    const [other] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-ws' })
      .returning();
    const [foreign] = await pg.handle.db
      .insert(t.conventions)
      .values({
        workspaceId: other!.id,
        repoId: null,
        rule: 'Foreign rule',
        ruleKey: 'foreign rule',
        category: 'other',
      })
      .returning();

    const res = await app.inject({
      method: 'PATCH',
      url: `/conventions/${foreign!.id}`,
      payload: { status: 'accepted' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('folds chosen candidates into a skill and attaches it to an agent', async () => {
    const app = await makeApp();
    const list = (await app.inject({ url: `/repos/${repoId}/conventions` })).json();
    const ids = list.map((c: { id: string }) => c.id);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Conventions Test Agent',
          provider: 'openai',
          model: 'gpt-4o-mini',
          system_prompt: 'Review the diff.',
        },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {
        candidate_ids: ids,
        name: 'repo-conventions',
        description: 'House rules extracted from acme/payments-api.',
        body: '# repo-conventions\n\n## typing\n- Validate payloads with zod. (src/user.ts:3)',
        agent_id: agent.id,
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();

    expect(created.skill).toMatchObject({
      name: 'repo-conventions',
      type: 'convention',
      source: 'extracted',
      enabled: true,
      version: 1,
    });
    // The edited body is stored verbatim, not regenerated from the candidates.
    expect(created.skill.body).toContain('## typing');
    expect(created.skill.evidence_files).toEqual(['src/user.ts']);
    expect(created.linked_agent_id).toBe(agent.id);
    expect(created.accepted).toBe(ids.length);

    // Candidates are now accepted and attributed to the skill.
    const after = (await app.inject({ url: `/repos/${repoId}/conventions` })).json();
    for (const c of after) {
      expect(c.status).toBe('accepted');
      expect(c.accepted).toBe(true);
      expect(c.skill_id).toBe(created.skill.id);
    }

    // And the skill is linked to the agent, appended at the end.
    const [link] = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(
        and(
          eq(t.agentSkills.agentId, agent.id),
          eq(t.agentSkills.skillId, created.skill.id),
        ),
      );
    expect(link).toBeDefined();
    expect(link!.order).toBe(0);
    await app.close();
  });

  it('404s when none of the candidate ids belong to the repo', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {
        candidate_ids: ['00000000-0000-0000-0000-000000000000'],
        name: 'repo-conventions',
        description: '',
        body: '# nope',
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
