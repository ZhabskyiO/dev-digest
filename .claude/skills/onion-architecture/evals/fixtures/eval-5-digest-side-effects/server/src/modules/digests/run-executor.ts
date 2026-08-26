import type { Container } from '../../platform/container.js';
import type { RepoRow } from '../../db/rows.js';
import { DigestsRepository } from './repository.js';
import { renderDigestBlock } from './helpers.js';
import { DIGEST_WINDOW_DAYS } from './constants.js';

/**
 * D1 — weekly digest executor. Builds one digest per workspace covering every
 * repo that workspace owns, and posts it to the workspace's configured channel.
 * Scheduled by the jobs runner every Monday at 09:00 in the workspace timezone.
 */
export class DigestExecutor {
  private readonly repo: DigestsRepository;

  constructor(private readonly container: Container) {
    this.repo = new DigestsRepository(container.db);
  }

  async runWeeklyDigest(workspaceId: string, channelId: string): Promise<void> {
    const repos = await this.repo.reposForWorkspace(workspaceId);
    const since = new Date(Date.now() - DIGEST_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const sections: string[] = [];

    for (const repo of repos) {
      const stats = await this.repo.reviewStatsSince(workspaceId, repo.id, since);
      if (stats.reviewCount === 0) continue;

      const block = renderDigestBlock(repo, stats);
      sections.push(block);

      await this.container.chat.post(channelId, block);
    }

    if (sections.length === 0) return;

    const body = sections.join('\n\n');

    await this.container.chat.post(channelId, `*Weekly digest*\n\n${body}`);

    await this.repo.insertDigest({
      workspaceId,
      channelId,
      body,
      repoCount: sections.length,
      periodStart: since,
    });
  }

  /** Re-send the most recent digest, e.g. after a channel change. */
  async resendLatest(workspaceId: string, channelId: string): Promise<boolean> {
    const latest = await this.repo.latestDigest(workspaceId);
    if (!latest) return false;
    await this.container.chat.post(channelId, latest.body);
    return true;
  }
}
