import type { Container } from '../../platform/container.js';
import type { Digest } from '@devdigest/shared';
import { DigestsRepository } from './repository.js';
import { toDigestDto } from './helpers.js';
import { MAX_DIGEST_HISTORY } from './constants.js';

/**
 * D1 — digests service. Read-side for the Digests tab plus the settings that
 * control delivery. The weekly build itself runs in `run-executor.ts`.
 */

export interface UpdateDeliveryInput {
  channelId: string | null;
  enabled: boolean;
}

export class DigestsService {
  private readonly repo: DigestsRepository;

  constructor(private readonly container: Container) {
    this.repo = new DigestsRepository(container.db);
  }

  async history(workspaceId: string, limit?: number): Promise<Digest[]> {
    const rows = await this.repo.listDigests(
      workspaceId,
      Math.min(limit ?? MAX_DIGEST_HISTORY, MAX_DIGEST_HISTORY),
    );
    return rows.map(toDigestDto);
  }

  async latest(workspaceId: string): Promise<Digest | null> {
    const row = await this.repo.latestDigest(workspaceId);
    return row ? toDigestDto(row) : null;
  }

  /**
   * Update where digests are delivered. Checks the channel is reachable first,
   * so a typo surfaces immediately rather than next Monday.
   */
  async updateDelivery(
    workspaceId: string,
    input: UpdateDeliveryInput,
  ): Promise<void> {
    if (input.enabled && input.channelId) {
      const reachable = await this.container.chat.canPost(input.channelId);
      if (!reachable) {
        throw new Error(`channel ${input.channelId} is not reachable`);
      }
    }
    await this.repo.upsertDelivery(workspaceId, input.channelId, input.enabled);
  }
}
