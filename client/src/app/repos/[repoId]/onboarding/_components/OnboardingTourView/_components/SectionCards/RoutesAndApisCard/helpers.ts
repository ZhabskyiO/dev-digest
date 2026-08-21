import type { OnboardingRouteEntry } from "@devdigest/shared";

/**
 * Groups API endpoint entries by their `group` (area), preserving each
 * group's first-seen order. Items already arrive deterministically ordered
 * from the server (surface, group, route, method — AC-53), so first-seen
 * insertion order is the right group order too.
 */
export function groupByArea(items: OnboardingRouteEntry[]): [string, OnboardingRouteEntry[]][] {
  const order: string[] = [];
  const groups = new Map<string, OnboardingRouteEntry[]>();
  for (const item of items) {
    const bucket = groups.get(item.group);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(item.group, [item]);
      order.push(item.group);
    }
  }
  return order.map((group) => [group, groups.get(group) ?? []]);
}
