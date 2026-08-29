import type { IconName } from "@devdigest/ui";

/** Editor tab descriptor. `labelKey` resolves under the `agents` namespace. */
export interface EditorTab {
  key: string;
  labelKey: string;
  icon: IconName;
}

/** Editor tabs. Part-0 shipped Config only; L02 adds Skills + Stats; the
 *  project-context spec adds Context (specs/2026-08-18-project-context.md). */
export const TABS: readonly EditorTab[] = [
  { key: "config", labelKey: "editor.tabs.config", icon: "Settings" },
  { key: "skills", labelKey: "editor.tabs.skills", icon: "Sparkles" },
  { key: "context", labelKey: "editor.tabs.context", icon: "FileText" },
  { key: "evals", labelKey: "editor.tabs.evals", icon: "FlaskConical" },
  { key: "stats", labelKey: "editor.tabs.stats", icon: "BarChart" },
  { key: "ci", labelKey: "editor.tabs.ci", icon: "Workflow" },
  { key: "versions", labelKey: "editor.tabs.versions", icon: "History" },
];

/** The `?tab=` allowlist, DERIVED from `TABS` — mirrors SkillDetail's
 *  `TAB_KEYS`. Never restate these keys as a literal in the page: a
 *  hand-maintained second list silently drifts the moment a tab is added, and
 *  the symptom is a tab that highlights for one render and then bounces back
 *  to `DEFAULT_TAB` (which is exactly what Context did). */
export const TAB_KEYS: readonly string[] = TABS.map((t) => t.key);
export const DEFAULT_TAB = "config";
