import type { SkillCase } from "../../src/index.js";

const SERVICE = `// server/src/modules/notifications/service.ts
import { db } from "../../db/client.js";
import { notifications } from "../../db/schema.js";
import { SlackClient } from "../../adapters/slack/client.js";
import { eq } from "drizzle-orm";

export class NotificationsService {
  private slack = new SlackClient(process.env.SLACK_TOKEN!);
  async notifyReviewDone(reviewId: string) {
    const rows = await db.select().from(notifications).where(eq(notifications.reviewId, reviewId));
    for (const row of rows) await this.slack.post(row.channel, "Review " + reviewId + " finished");
  }
}`;

export const cases: SkillCase[] = [
  {
    name: "service importing a concrete adapter and db/schema is moved behind a port, a repository and the container",
    kind: "quality",
    prompt: `Review this new backend module against our layering rules and tell me what to change.\n\n${SERVICE}`,
    practices: [
      "flags the service importing a concrete adapter (src/adapters/slack/client.js) as a violation of 'services depend on ports' and prescribes a port interface in @devdigest/shared (src/vendor/shared/adapters.ts) with the adapter implementing it",
      "flags the direct db/schema + drizzle-orm query inside the service and moves it into modules/notifications/repository.ts",
      "wires the adapter through platform/container.ts as a lazy getter (and a ContainerOverrides field for tests) instead of new SlackClient(...) inside the service",
      "names the dependency-cruiser gate (npm run depcruise / the services-depend-on-ports and db-confined-to-repositories rules) as the thing that will enforce the fix",
      "does not suggest moving this I/O code into reviewer-core (the core must stay pure)",
    ],
    threshold: 0.6,
    maxTurns: 8,
  },
];
