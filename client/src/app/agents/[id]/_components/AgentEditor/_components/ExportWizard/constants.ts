import type { CiPostAs, CiTarget, CiTrigger } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** `owner/name` — matches the server's own validation (T13, AC-10 server side). */
export const REPO_PATTERN = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/**
 * The LLM API key secret name the generated workflow references
 * (`server/src/modules/ci/constants.ts`'s `LLM_SECRET_NAME`). Display-only
 * duplication, not a cross-package import — client/ and server/ are
 * standalone packages (see root CLAUDE.md).
 */
export const LLM_SECRET_NAME = "OPENROUTER_API_KEY";

/** Step 1's four target cards — only `gha` is selectable today (AC-11). */
export const TARGET_OPTIONS: { value: CiTarget; icon: IconName; disabled: boolean }[] = [
  { value: "gha", icon: "Workflow", disabled: false },
  { value: "circle", icon: "RefreshCw", disabled: true },
  { value: "jenkins", icon: "Settings", disabled: true },
  { value: "cli", icon: "Command", disabled: true },
];

/** Step 3's trigger checkboxes, in the order the generated workflow lists them. */
export const TRIGGER_OPTIONS: CiTrigger[] = ["opened", "synchronize", "reopened"];

/** Step 3's post-destination radios. */
export const POST_AS_OPTIONS: CiPostAs[] = ["github_review", "pr_comment", "none"];

/** `CiPostAs` value → the catalogue's camelCase leaf under `exportWizard.postAs.*`. */
export const POST_AS_LABEL_KEY: Record<CiPostAs, string> = {
  github_review: "githubReview",
  pr_comment: "prComment",
  none: "none",
};
