import type { FindingActionKind } from "@devdigest/shared";

/** "learn" and "reply" aren't wired to a real endpoint yet — `reviews/routes.ts`'s
 *  `FINDING_ACTIONS` only registers accept/dismiss. Rendered as disabled controls
 *  (via `FindingCard`'s `unavailableActions`) instead of a request that would 404. */
export const UNAVAILABLE_ACTIONS: FindingActionKind[] = ["learn", "reply"];
