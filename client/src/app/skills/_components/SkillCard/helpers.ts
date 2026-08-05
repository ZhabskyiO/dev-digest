import type { Skill, SkillType } from "@devdigest/shared";
import { TYPE_COLOR } from "./constants";

/** Resolve the chip colour for a skill's type (unknown → secondary token). */
export function typeColor(type: SkillType): string {
  return TYPE_COLOR[type] ?? "var(--text-secondary)";
}

/**
 * A skill "needs vetting" when it came from anywhere other than a manual
 * paste AND is still disabled — the enabled toggle IS the vetting decision,
 * so once it's flipped on the badge goes away even though the source is
 * unchanged.
 */
export function needsVetting(skill: Pick<Skill, "source" | "enabled">): boolean {
  return skill.source !== "manual" && !skill.enabled;
}
