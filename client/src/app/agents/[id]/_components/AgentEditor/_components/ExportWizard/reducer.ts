import type { CiFile, CiPostAs, CiTrigger } from "@devdigest/shared";
import { REPO_PATTERN, TRIGGER_OPTIONS } from "./constants";

/** All four steps' answers, in ONE reducer (task T14: "wizard state in ONE
 *  useReducer") — no step owns its own local state, so nothing is lost when
 *  the user moves back and forth between steps. */
export interface WizardState {
  step: number;
  repo: string;
  triggers: CiTrigger[];
  postAs: CiPostAs;
  action: "open_pr" | "files";
  selectedFilePath: string | null;
  /** This-export-only edit to the editable file's contents (AC-56) — never
   *  written back into `previewFiles`, only overlaid at render/install time. */
  workflowOverride: string | null;
  previewFiles: CiFile[] | null;
  /** The `previewTupleKey()` the CURRENT `previewFiles` were fetched for —
   *  compared against the live tuple to decide whether to refetch (R3, AC-56). */
  previewKey: string | null;
  /** Set once the Step 4 archive download has actually happened, so the
   *  "I've added these files" confirmation only appears after it (AC-31). */
  downloaded: boolean;
}

export const initialWizardState: WizardState = {
  step: 0,
  repo: "",
  triggers: [...TRIGGER_OPTIONS],
  postAs: "github_review",
  action: "open_pr",
  selectedFilePath: null,
  workflowOverride: null,
  previewFiles: null,
  previewKey: null,
  downloaded: false,
};

export type WizardAction =
  | { type: "RESET" }
  | { type: "GO_TO_STEP"; step: number }
  | { type: "SET_REPO"; repo: string }
  | { type: "TOGGLE_TRIGGER"; trigger: CiTrigger }
  | { type: "SET_POST_AS"; postAs: CiPostAs }
  | { type: "SET_ACTION"; action: "open_pr" | "files" }
  | { type: "SELECT_FILE"; path: string }
  | { type: "SET_WORKFLOW_OVERRIDE"; contents: string }
  | { type: "PREVIEW_SUCCESS"; files: CiFile[]; key: string }
  | { type: "SET_DOWNLOADED"; downloaded: boolean };

/** A repo/trigger/post_as change invalidates whatever was previously
 *  generated — a stale bundle must never survive to be installed (AC-56,
 *  AC-57: "returning to Step 1 and changing the repo invalidates the
 *  preview"). Applies the same guard to Step 3's fields for the same reason:
 *  the workflow's own contents depend on triggers/post_as too. */
function clearedPreview() {
  return {
    previewFiles: null,
    previewKey: null,
    workflowOverride: null,
    selectedFilePath: null,
    downloaded: false,
  };
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "RESET":
      return initialWizardState;
    case "GO_TO_STEP":
      return { ...state, step: Math.max(0, Math.min(3, action.step)) };
    case "SET_REPO":
      return { ...state, repo: action.repo, ...clearedPreview() };
    case "TOGGLE_TRIGGER": {
      const has = state.triggers.includes(action.trigger);
      const triggers = has
        ? state.triggers.filter((trig) => trig !== action.trigger)
        : [...state.triggers, action.trigger];
      return { ...state, triggers, ...clearedPreview() };
    }
    case "SET_POST_AS":
      return { ...state, postAs: action.postAs, ...clearedPreview() };
    case "SET_ACTION":
      return { ...state, action: action.action };
    case "SELECT_FILE":
      return { ...state, selectedFilePath: action.path };
    case "SET_WORKFLOW_OVERRIDE":
      return { ...state, workflowOverride: action.contents };
    case "PREVIEW_SUCCESS": {
      // Ignore a success whose tuple key no longer matches the CURRENT
      // (repo, triggers, postAs) tuple — a slow response for a tuple the
      // user has since moved away from (e.g. changed the repo again before
      // this one resolved) must never overwrite the newer preview it raced
      // against. Also collapses StrictMode's double-mount into a no-op on
      // the second, redundant success for the same tuple.
      if (action.key !== previewTupleKey(state)) return state;
      // Default-select the editable file (the workflow) — not files[0] — so
      // the thing a user is most likely to want to look at/edit is already
      // open (matches the design screenshots).
      const editable = action.files.find((f) => f.editable);
      return {
        ...state,
        previewFiles: action.files,
        previewKey: action.key,
        selectedFilePath: editable?.path ?? action.files[0]?.path ?? null,
        workflowOverride: null,
      };
    }
    case "SET_DOWNLOADED":
      return { ...state, downloaded: action.downloaded };
    default:
      return state;
  }
}

/** Per-step "can Continue" gate — computed from state, never stored. */
export function canContinue(state: WizardState): boolean {
  switch (state.step) {
    case 0:
      return REPO_PATTERN.test(state.repo);
    case 1:
      return !!state.previewFiles && state.previewFiles.length > 0;
    case 2:
      return state.triggers.length > 0;
    default:
      return true;
  }
}

/** The (repo, triggers, post_as) tuple a preview was generated for — order-
 *  independent on `triggers` so toggling them off and back on in the same
 *  set doesn't look like a new tuple. */
export function previewTupleKey(state: Pick<WizardState, "repo" | "triggers" | "postAs">): string {
  return JSON.stringify({ repo: state.repo, triggers: [...state.triggers].sort(), postAs: state.postAs });
}
