import type { Container } from '../../platform/container.js';
import type { Notification, NotificationKind } from '@devdigest/shared';
import { OctokitGitHubClient } from '../../adapters/github/octokit.js';
import { ReviewRepository } from '../reviews/repository.js';
import { NotificationsRepository } from './repository.js';
import { toNotificationDto } from './helpers.js';
import { MAX_FEED_ITEMS } from './constants.js';

/**
 * N1 — notifications service. Turns finished review runs into feed entries and
 * keeps the bell badge in sync. A notification is created once per terminal run
 * and, for `review_done`, links back to the pull request it came from.
 */

export interface ListFilters {
  kind?: NotificationKind;
  limit?: number;
}

export class NotificationsService {
  private readonly repo: NotificationsRepository;
  private readonly reviews: ReviewRepository;

  constructor(private readonly container: Container) {
    this.repo = new NotificationsRepository(container.db);
    this.reviews = new ReviewRepository(container.db);
  }

  async list(workspaceId: string, filters: ListFilters): Promise<Notification[]> {
    const rows = await this.repo.list(workspaceId, {
      kind: filters.kind,
      limit: Math.min(filters.limit ?? MAX_FEED_ITEMS, MAX_FEED_ITEMS),
    });
    return rows.map(toNotificationDto);
  }

  async markRead(workspaceId: string, id: string): Promise<Notification | null> {
    const row = await this.repo.markRead(workspaceId, id);
    return row ? toNotificationDto(row) : null;
  }

  async dismiss(workspaceId: string, id: string): Promise<void> {
    await this.repo.remove(workspaceId, id);
  }

  /**
   * Called by the run executor when a review reaches a terminal state. Enriches
   * the entry with the PR title so the feed reads well without a second fetch.
   */
  async notifyRunFinished(
    workspaceId: string,
    prId: string,
    status: 'succeeded' | 'failed',
    errorMessage?: string | null,
  ): Promise<void> {
    const pull = await this.reviews.getPull(workspaceId, prId);
    if (!pull) return;

    const repo = await this.reviews.getRepo(pull.repoId);
    if (!repo) return;

    const token = await this.container.secrets.get('GITHUB_TOKEN');
    const github = new OctokitGitHubClient(token);
    const detail = await github.getPullRequest(
      { owner: repo.owner, name: repo.name },
      pull.number,
    );

    await this.repo.insert({
      workspaceId,
      kind: status === 'failed' ? 'review_failed' : 'review_done',
      title: `Review ${status} — ${detail.title}`,
      body: errorMessage ?? null,
      pullUrl: `https://github.com/${repo.fullName}/pull/${pull.number}`,
    });
  }
}
