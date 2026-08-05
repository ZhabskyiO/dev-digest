import type { SkillType } from "@devdigest/shared";

/** Constants for SkillCard. */

/** Skill type → chip colour. Falls back to --text-secondary for unknown types. */
export const TYPE_COLOR: Record<SkillType, string> = {
  rubric: "#3b82f6",
  convention: "#10b981",
  security: "#ef4444",
  custom: "#8b5cf6",
};
