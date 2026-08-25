import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCaseSummary } from "@devdigest/shared";
import evalMessages from "../../../messages/en/eval.json";

const createMutate = vi.fn();
const updateMutate = vi.fn();
const runOneMutate = vi.fn();

vi.mock("../../lib/hooks/evals", () => ({
  useCreateEvalCase: () => ({ mutate: createMutate, isPending: false }),
  useUpdateEvalCase: () => ({ mutate: updateMutate, isPending: false }),
  useRunEvalCase: () => ({ mutate: runOneMutate, isPending: false }),
}));
vi.mock("../../lib/toast", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

import { CaseEditorModal } from "./CaseEditorModal";

const OWNER = { kind: "agent" as const, id: "ag1", name: "Security Reviewer" };

const EXISTING: EvalCaseSummary = {
  id: "c1",
  agent_id: "ag1",
  name: "stripe-key-leak",
  input_diff: "diff --git a/src/config.ts b/src/config.ts",
  expectation: { type: "must_find", file: "src/config.ts", start_line: 12, end_line: 12 },
  notes: null,
  meta: null,
  last_run: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal(existing: EvalCaseSummary | null = null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
      <CaseEditorModal owner={OWNER} existing={existing} onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

const runButton = () => screen.getByText("Run case").closest("button")!;

describe("CaseEditorModal — Run case on a new case", () => {
  it("is disabled while required fields are empty", () => {
    renderModal();
    expect(runButton()).toBeDisabled();
  });

  it("enables once name + diff are filled (expected JSON is prefilled valid)", () => {
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "my-case" },
    });
    fireEvent.change(screen.getByTestId("diff-editor"), {
      target: { value: "diff --git a/a.ts b/a.ts" },
    });
    expect(runButton()).not.toBeDisabled();
  });

  it("creates the case first, then runs it with the new id", () => {
    createMutate.mockImplementation((_payload, opts) => opts?.onSuccess?.({ id: "new1" }));
    renderModal();
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "my-case" },
    });
    fireEvent.change(screen.getByTestId("diff-editor"), {
      target: { value: "diff --git a/a.ts b/a.ts" },
    });
    fireEvent.click(runButton());
    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(createMutate.mock.calls[0]![0]).toMatchObject({ name: "my-case" });
    expect(runOneMutate).toHaveBeenCalledWith({ caseId: "new1" }, expect.anything());
  });

  it("persists edits to an already-saved case (update, not create) before running", () => {
    updateMutate.mockImplementation((_vars, opts) => opts?.onSuccess?.());
    renderModal(EXISTING);
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "renamed-case" },
    });
    fireEvent.click(runButton());
    expect(createMutate).not.toHaveBeenCalled();
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate.mock.calls[0]![0]).toMatchObject({
      caseId: "c1",
      patch: { name: "renamed-case" },
    });
    expect(runOneMutate).toHaveBeenCalledWith({ caseId: "c1" }, expect.anything());
  });

  it("does not run when the update fails", () => {
    updateMutate.mockImplementation(() => {});
    renderModal(EXISTING);
    fireEvent.click(runButton());
    expect(runOneMutate).not.toHaveBeenCalled();
  });
});
