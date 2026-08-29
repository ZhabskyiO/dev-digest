import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, CiExport, CiFile, CiPreview } from "@devdigest/shared";
import type { CiArchiveResult } from "@/lib/hooks/ci";
// 8×`../` reaches `client/` from here: `messages/` sits at the package root,
// one level above `src/`, and this file sits 7 directories inside `src/`
// (app/agents/[id]/_components/AgentEditor/_components/ExportWizard) — see
// client/insights/gotchas.md's 2026-08-04 entry.
import messages from "../../../../../../../../messages/en/ci.json";
import { ExportWizard } from "./ExportWizard";

const previewMutate = vi.hoisted(() => vi.fn());
const exportMutate = vi.hoisted(() => vi.fn());
const archiveMutate = vi.hoisted(() => vi.fn());
const confirmMutate = vi.hoisted(() => vi.fn());
const useCiPreview = vi.hoisted(() => vi.fn());
const useCiExport = vi.hoisted(() => vi.fn());
const useCiArchive = vi.hoisted(() => vi.fn());
const useConfirmCiInstallation = vi.hoisted(() => vi.fn());
// jsdom implements neither `atob` output plumbing nor `URL.createObjectURL`
// (confirmed: `typeof URL.createObjectURL === "undefined"` in this test env),
// so `download.ts`'s real `downloadArchive` throws before this test's
// assertions ever run. Mock the download helper itself — it's a one-line,
// side-effect-only browser API call with no logic of its own to verify here;
// what AC-31 needs proven is WHEN it's called relative to the confirm click,
// not how it decodes bytes.
const downloadArchive = vi.hoisted(() => vi.fn());

vi.mock("@/lib/hooks/ci", () => ({ useCiPreview, useCiExport, useCiArchive, useConfirmCiInstallation }));
vi.mock("./download", () => ({ downloadArchive }));

afterEach(cleanup);

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

/** Deliberate deviation from the design screenshots (per this task's brief):
 *  no `memory.jsonl` — the real preview response is the source of truth, and
 *  only the workflow is `editable`. */
const PREVIEW_FILES: CiFile[] = [
  {
    path: ".devdigest/agents/security-reviewer.yaml",
    contents: "name: Security Reviewer\nprovider: openai\n",
    editable: false,
  },
  {
    path: ".devdigest/skills/secret-leakage-gate.md",
    contents: "# Secret leakage gate\n",
    editable: false,
  },
  {
    path: ".github/workflows/devdigest-review.yml",
    contents: "name: DevDigest Review\non:\n  pull_request:\n    types: [opened, synchronize, reopened]\n",
    editable: true,
  },
];

function previewResponse(over: Partial<CiPreview> = {}): CiPreview {
  return { repo: "acme/payments-api", files: PREVIEW_FILES, ...over };
}

function renderWizard(props: Partial<React.ComponentProps<typeof ExportWizard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      <ExportWizard agent={AGENT} open onClose={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );
}

/** Builds the `exportWizard.stepIndicator` accessible name from the real
 *  catalogue string rather than restating the English text — see client/
 *  insights/gotchas.md's 2026-08-20 "sourced from the catalogue" entry. */
function stepIndicatorLabel(current: number, total: number): string {
  return messages.exportWizard.stepIndicator
    .replace("{current}", String(current))
    .replace("{total}", String(total));
}

function goToStep2() {
  fireEvent.change(screen.getByPlaceholderText("acme/payments-api"), { target: { value: "acme/payments-api" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

beforeEach(() => {
  previewMutate.mockReset().mockImplementation((_vars, opts) => opts?.onSuccess?.(previewResponse()));
  exportMutate.mockReset();
  archiveMutate.mockReset();
  confirmMutate.mockReset();
  downloadArchive.mockReset();
  useCiPreview.mockReset().mockReturnValue({ mutate: previewMutate, isPending: false, isError: false, error: null });
  useCiExport
    .mockReset()
    .mockReturnValue({ mutate: exportMutate, isPending: false, isError: false, error: null, isSuccess: false, data: undefined });
  useCiArchive
    .mockReset()
    .mockReturnValue({ mutate: archiveMutate, isPending: false, isError: false, error: null, isSuccess: false, data: undefined });
  useConfirmCiInstallation.mockReset().mockReturnValue({ mutate: confirmMutate, isPending: false });
});

describe("ExportWizard", () => {
  it("opens showing all four step labels with Step 1 current (AC-9)", () => {
    renderWizard();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Configure")).toBeInTheDocument();
    expect(screen.getByText("Install")).toBeInTheDocument();
    expect(screen.getByLabelText(stepIndicatorLabel(1, 4))).toBeInTheDocument();
  });

  it("disables Continue until a valid repo is entered and flags an invalid shape (AC-10)", () => {
    renderWizard();
    const continueBtn = screen.getByRole("button", { name: "Continue" });
    expect(continueBtn).toBeDisabled();

    const repoInput = screen.getByPlaceholderText("acme/payments-api");
    fireEvent.change(repoInput, { target: { value: "not-a-repo" } });
    expect(continueBtn).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(messages.exportWizard.repoInvalid);

    fireEvent.change(repoInput, { target: { value: "acme/payments-api" } });
    expect(continueBtn).not.toBeDisabled();
  });

  it("leaves GitHub Actions selected and does not advance when a disabled card is clicked (AC-11)", () => {
    renderWizard();
    const circleCard = screen.getByRole("radio", { name: /CircleCI/ });
    expect(circleCard).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(circleCard);

    expect(screen.getByRole("radio", { name: /GitHub Actions/ })).toHaveAttribute("aria-checked", "true");
    // Still on Step 1 — Target is the current step.
    expect(screen.getByLabelText(stepIndicatorLabel(1, 4))).toBeInTheDocument();
  });

  it("renders the mocked file list on Step 2 with only the workflow editable (AC-13, AC-18)", () => {
    renderWizard();
    goToStep2();

    expect(screen.getByRole("button", { name: ".devdigest/agents/security-reviewer.yaml" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ".devdigest/skills/secret-leakage-gate.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ".github/workflows/devdigest-review.yml" })).toBeInTheDocument();
    expect(screen.queryByText("memory.jsonl")).not.toBeInTheDocument();

    // The workflow is auto-selected (it's the editable one) and renders as a textarea
    // — its path shows in both the file list button and the viewer header.
    expect(screen.getByRole("textbox")).toHaveValue(PREVIEW_FILES[2]!.contents);
    expect(screen.getByText("editable")).toBeInTheDocument();

    // Selecting a non-editable file swaps the textarea for read-only content.
    fireEvent.click(screen.getByRole("button", { name: ".devdigest/agents/security-reviewer.yaml" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText("editable")).not.toBeInTheDocument();
  });

  it("ignores a stale preview response for an abandoned (repo/triggers/postAs) tuple (AC-56, AC-57)", () => {
    const previewCalls: Array<{ vars: unknown; opts?: { onSuccess?: (data: CiPreview) => void } }> = [];
    previewMutate.mockReset().mockImplementation((vars, opts) => {
      previewCalls.push({ vars, opts });
    });

    renderWizard();
    goToStep2();
    expect(previewCalls).toHaveLength(1);

    // Abandon the first (repo) tuple before it resolves — go back and pick a
    // different target repo, which fires a SECOND preview request.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByPlaceholderText("acme/payments-api"), {
      target: { value: "acme/other-repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(previewCalls).toHaveLength(2);

    const staleFiles: CiFile[] = [{ path: "STALE_MARKER.yml", contents: "stale", editable: false }];
    const freshFiles: CiFile[] = [{ path: "FRESH_MARKER.yml", contents: "fresh", editable: false }];

    // The FIRST (now-abandoned) request resolves after the second has
    // already been fired — its success must be ignored, not overwrite the
    // preview the user is now looking at.
    act(() => previewCalls[0]!.opts?.onSuccess?.(previewResponse({ files: staleFiles })));
    expect(screen.queryByRole("button", { name: "STALE_MARKER.yml" })).not.toBeInTheDocument();

    // The second, still-current request resolving normally still updates
    // the view.
    act(() => previewCalls[1]!.opts?.onSuccess?.(previewResponse({ files: freshFiles })));
    expect(screen.getByRole("button", { name: "FRESH_MARKER.yml" })).toBeInTheDocument();
  });

  it("offers a Retry control on a preview failure that re-fires the request for the current tuple (AC-57)", () => {
    useCiPreview.mockReturnValue({ mutate: previewMutate, isPending: false, isError: true, error: new Error("network down") });
    renderWizard();
    goToStep2();

    expect(screen.getByRole("alert")).toHaveTextContent("network down");
    previewMutate.mockClear();
    fireEvent.click(screen.getByRole("button", { name: messages.exportWizard.retry }));
    expect(previewMutate).toHaveBeenCalledTimes(1);
  });

  it("disables Continue once all three triggers are deselected (AC-20)", () => {
    renderWizard();
    goToStep2();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    checkboxes.forEach((cb) => fireEvent.click(cb));

    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(screen.getByText(messages.exportWizard.triggersRequired)).toBeInTheDocument();
  });

  it("defaults to github_review and carries it into the export request body (AC-21)", () => {
    renderWizard();
    goToStep2();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const radios = screen.getAllByRole("radio").filter((el) => el.getAttribute("name") === "ci-post-as");
    expect(radios[0]).toBeChecked(); // github_review is first and defaults on

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(exportMutate).toHaveBeenCalledWith(expect.objectContaining({ post_as: "github_review" }));
  });

  it("renders the secret name and distinguishes it from the automatic token (AC-24)", () => {
    renderWizard();
    goToStep2();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText(/OPENROUTER_API_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/GITHUB_TOKEN is supplied automatically/)).toBeInTheDocument();
  });

  it("renders both install methods with the PR option pre-selected (AC-25)", () => {
    renderWizard();
    goToStep2();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("radio", { name: "Open a pull request" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Download files" })).toHaveAttribute("aria-checked", "false");
  });

  it("creates no installation record until the download is confirmed (AC-31)", () => {
    const archiveResult: CiArchiveResult = { filename: "devdigest-ci.zip", content_base64: "AAAA" };
    archiveMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.(archiveResult));

    renderWizard();
    goToStep2();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("radio", { name: "Download files" }));
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    // The download path ran and the archive landed on disk, but no
    // installation record exists yet — `useConfirmCiInstallation`'s mutate
    // must not have been called just because a download happened.
    expect(archiveMutate).toHaveBeenCalledTimes(1);
    expect(downloadArchive).toHaveBeenCalledWith(archiveResult);
    expect(confirmMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: messages.exportWizard.downloadConfirm }));

    // Only the explicit confirmation click creates the installation record.
    expect(confirmMutate).toHaveBeenCalledTimes(1);
  });

  it("stays on Step 4 with the answers intact and renders the server message on failure (AC-32)", () => {
    useCiExport.mockReturnValue({
      mutate: exportMutate,
      isPending: false,
      isError: true,
      error: new Error("Couldn't verify the repository exists"),
      isSuccess: false,
      data: undefined,
    });
    renderWizard();
    goToStep2();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't verify the repository exists");
    expect(screen.getByLabelText(stepIndicatorLabel(4, 4))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByPlaceholderText("acme/payments-api")).toHaveValue("acme/payments-api");
  });

  it("disables Install and shows the progress label while pending (AC-51)", () => {
    useCiExport.mockReturnValue({
      mutate: exportMutate,
      isPending: true,
      isError: false,
      error: null,
      isSuccess: false,
      data: undefined,
    });
    renderWizard();
    goToStep2();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const installBtn = screen.getByRole("button", { name: "Installing…" });
    expect(installBtn).toBeDisabled();
  });

  it("renders an invalid-YAML failure inline with no PR link (AC-57)", () => {
    useCiExport.mockReturnValue({
      mutate: exportMutate,
      isPending: false,
      isError: true,
      error: new Error("Invalid workflow YAML: bad indentation at line 3"),
      isSuccess: false,
      data: undefined,
    });
    renderWizard();
    goToStep2();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText(messages.exportWizard.workflowInvalidYaml)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("closes on Escape and restores focus to the invoking control", () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
          <button onClick={() => setOpen(true)}>Open wizard</button>
          <ExportWizard agent={AGENT} open={open} onClose={() => setOpen(false)} />
        </NextIntlClientProvider>
      );
    }
    render(<Harness />);
    const openBtn = screen.getByRole("button", { name: "Open wizard" });
    // `fireEvent.click` doesn't simulate the browser's click-focuses-the-
    // button behavior (that needs `@testing-library/user-event`, not a
    // dependency here — client/insights/gotchas.md), so focus it explicitly
    // to set up the "focus returns to the invoking control" assertion below.
    openBtn.focus();
    fireEvent.click(openBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(openBtn);
  });
});
