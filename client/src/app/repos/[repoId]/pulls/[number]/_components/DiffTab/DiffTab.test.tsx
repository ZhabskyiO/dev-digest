import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, RunSummary } from "@devdigest/shared";
// 8×`../` reaches `client/` from here — same depth as the sibling
// SmartDiffViewer test. See client/insights/gotchas.md.
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { DiffTab } from "./DiffTab";

const usePrReviews = vi.hoisted(() => vi.fn());
const usePrRuns = vi.hoisted(() => vi.fn());
const usePrComments = vi.hoisted(() => vi.fn());
const useCreatePrComment = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews,
  usePrRuns,
  usePrComments,
  useCreatePrComment,
}));
// Both viewers are covered by their own tests; here they only have to prove
// which order is on screen when the token note renders, and (for
// SmartDiffViewer) that a `targetFileLine` prop actually reaches it.
const smartDiffViewerSpy = vi.hoisted(() => vi.fn());
vi.mock("../SmartDiffViewer", () => ({
  SmartDiffViewer: (props: unknown) => {
    smartDiffViewerSpy(props);
    return <div>smart-order-view</div>;
  },
}));
vi.mock("@/components/diff-viewer", () => ({ DiffViewer: () => <div>original-order-view</div> }));

afterEach(cleanup);

const FILES: PrFile[] = [
  { path: "src/api/rate-limit.ts", additions: 12, deletions: 3, patch: null },
];

function run(over: Partial<RunSummary>): RunSummary {
  return {
    run_id: "r1",
    agent_id: "a1",
    agent_name: "Reviewer",
    provider: "openai",
    model: "gpt-5",
    status: "done",
    error: null,
    duration_ms: 8000,
    tokens_in: 9000,
    tokens_out: 1000,
    findings_count: 2,
    grounding: null,
    ran_at: "2026-08-08T10:00:00.000Z",
    score: 80,
    blockers: 0,
    cost_usd: 0.02,
    ...over,
  };
}

function renderTab(targetFileLine?: { path: string; line: number } | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <DiffTab
        prId="pr-1"
        filesCount={FILES.length}
        files={FILES}
        {...(targetFileLine ? { targetFileLine } : {})}
      />
    </NextIntlClientProvider>,
  );
}

describe("DiffTab token note", () => {
  beforeEach(() => {
    usePrReviews.mockReturnValue({ data: [] });
    usePrComments.mockReturnValue({ data: [] });
    useCreatePrComment.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    usePrRuns.mockReturnValue({ data: [run({})] });
  });

  it("credits the last review's tokens in both orders", () => {
    renderTab();

    expect(screen.getByText("smart-order-view")).toBeTruthy();
    expect(screen.getByText(/0 new tokens · built on 10,000 from last review/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Original order" }));

    expect(screen.getByText("original-order-view")).toBeTruthy();
    expect(screen.getByText(/0 new tokens · built on 10,000 from last review/)).toBeTruthy();
  });

  it("counts one run per agent and ignores runs that never produced findings", () => {
    // Newest-first, as `usePrRuns` returns: the re-run replaces the older run
    // of the same agent, the failed and running rows count for nothing, and the
    // second agent's run adds to the total.
    usePrRuns.mockReturnValue({
      data: [
        run({ run_id: "r4", agent_id: "a2", status: "running", tokens_in: 0, tokens_out: 0 }),
        run({ run_id: "r3", agent_id: "a2", tokens_in: 500, tokens_out: 100 }),
        run({ run_id: "r2", agent_id: "a1", status: "failed", tokens_in: 700, tokens_out: 0 }),
        run({ run_id: "r1", agent_id: "a1", tokens_in: 9000, tokens_out: 1000 }),
      ],
    });

    renderTab();

    expect(screen.getByText(/built on 10,600 from last review/)).toBeTruthy();
  });

  it("says no review has run yet when there is nothing to build on", () => {
    usePrRuns.mockReturnValue({ data: [] });

    renderTab();

    expect(screen.getByText("0 new tokens · no review has run yet")).toBeTruthy();
  });

  it("threads targetFileLine into SmartDiffViewer as `target` (AC-26)", () => {
    smartDiffViewerSpy.mockClear();
    renderTab({ path: "src/api/rate-limit.ts", line: 4 });

    expect(smartDiffViewerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ target: { path: "src/api/rate-limit.ts", line: 4 } }),
    );
  });

  it("passes no `target` to SmartDiffViewer when there is no targetFileLine", () => {
    smartDiffViewerSpy.mockClear();
    renderTab();

    expect(smartDiffViewerSpy).toHaveBeenCalledWith(
      expect.not.objectContaining({ target: expect.anything() }),
    );
  });
});
