import type { BlastRadiusResult } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { LineRange } from '../repo-intel/types.js';
import { BlastRepository } from './repository.js';
import { changedLineRanges, toBlastDto } from './helpers.js';

/**
 * BlastService — the PR impact map.
 *
 * Reads only. Every symbol, caller and endpoint comes out of the repo-intel
 * index via the facade; this service resolves the PR, hands the changed file
 * list over, and shapes the answer. **No model is called anywhere in this
 * path** — that is a deliberate property, not an oversight: a blast map that a
 * model could hallucinate a node into is worthless as a review aid.
 *
 * Degrades rather than throws: an unindexed repo is a 200 carrying
 * `status: 'degraded'` + a reason, never a 5xx. The only 404 is a PR that does
 * not exist in this workspace.
 */
export class BlastService {
  private repo: BlastRepository;

  constructor(private container: Container) {
    this.repo = new BlastRepository(container.db);
  }

  async blastForPull(workspaceId: string, prId: string): Promise<BlastRadiusResult> {
    // Workspace-scoped FIRST. `getPrFiles` below is keyed by prId alone and is
    // NOT tenant-scoped, so resolving the pull inside the workspace is what
    // stops one workspace reading another's file list.
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.container.reviewRepo.getPrFiles(pull.id);
    const changedFiles = files.map((f) => f.path);

    // Scope "changed symbols" to the lines the diff actually touches. Without
    // this, editing one line of a repository file reports every symbol in that
    // file as changed — which is how a 5-symbol PR renders as 56.
    // Two sets of spans for two sets of line numbers: the index measured its
    // symbols against the diff's BASE, the head overlay parses the PR's own
    // files, so each is filtered with the side it belongs to. Crossing them
    // silently drops the wrong symbols.
    const touchedLines: Record<string, LineRange[]> = {};
    const touchedLinesHead: Record<string, LineRange[]> = {};
    for (const f of files) {
      const base = changedLineRanges(f.patch, 'base');
      if (base.length > 0) touchedLines[f.path] = base;
      const head = changedLineRanges(f.patch, 'head');
      if (head.length > 0) touchedLinesHead[f.path] = head;
    }

    const [blast, indexState, priorPrs] = await Promise.all([
      this.container.repoIntel.getBlastRadius(pull.repoId, changedFiles, {
        touchedLines,
        head: {
          prNumber: pull.number,
          sha: pull.headSha,
          touchedLines: touchedLinesHead,
        },
      }),
      this.container.repoIntel.getIndexState(pull.repoId),
      this.repo.priorPrsTouching(pull.repoId, pull.id, changedFiles),
    ]);

    return toBlastDto({
      pullId: pull.id,
      headSha: pull.headSha,
      changedFiles,
      blast,
      indexState,
      priorPrs: priorPrs.map((p) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        author: p.author,
        updated_at: p.updatedAt?.toISOString() ?? null,
        overlapping_files: p.overlappingFiles,
      })),
    });
  }
}
