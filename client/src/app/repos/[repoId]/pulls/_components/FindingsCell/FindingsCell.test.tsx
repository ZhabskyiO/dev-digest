import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrMeta, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

// The cell fetches lazily on hover; the mock records the prId it was called
// with so we can assert it stays idle until then.
const usePrReviews = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (prId: string | null | undefined) => usePrReviews(prId),
}));

import { FindingsCell } from "./FindingsCell";

afterEach(cleanup);

function finding(over: Partial<FindingRecord> & Pick<FindingRecord, "id">): FindingRecord {
  return {
    severity: "WARNING",
    category: "security",
    title: "A finding",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "Because reasons.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...over,
  } as FindingRecord;
}

function pr(counts: PrMeta["findings_by_severity"]): PrMeta {
  return {
    id: "pr1",
    number: 482,
    title: "Add rate limiting",
    author: "marisa.koch",
    branch: "feat/rl",
    base: "main",
    head_sha: "abc",
    additions: 1,
    deletions: 0,
    files_count: 1,
    status: "needs_review",
    opened_at: null,
    updated_at: null,
    score: 61,
    cost_usd: null,
    findings_by_severity: counts,
  };
}

function reviewsResult(over: Partial<{ data: ReviewRecord[]; isPending: boolean; isError: boolean }>) {
  return { data: undefined, isPending: false, isError: false, ...over };
}

function renderCell(meta: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsCell pr={meta} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  usePrReviews.mockReset();
  usePrReviews.mockReturnValue(reviewsResult({ data: [] }));
});

describe("FindingsCell", () => {
  it("shows a count per non-zero severity and hides the empty ones", () => {
    renderCell(pr({ CRITICAL: 2, WARNING: 0, SUGGESTION: 3 }));
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders an em dash when the PR has no findings at all", () => {
    renderCell(pr({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("renders an em dash when the API omits the tally entirely", () => {
    renderCell(pr(null));
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("stays idle until hovered, then fetches that PR's reviews", async () => {
    usePrReviews.mockReturnValue(
      reviewsResult({
        data: [{ findings: [finding({ id: "f1", title: "N+1 query" })] } as ReviewRecord],
      }),
    );
    renderCell(pr({ CRITICAL: 0, WARNING: 1, SUGGESTION: 0 }));

    // Idle: the hook is called on every render, but with a null id.
    expect(usePrReviews).toHaveBeenCalledWith(null);

    fireEvent.mouseEnter(screen.getByText("1"));
    await waitFor(() => expect(usePrReviews).toHaveBeenCalledWith("pr1"));
    expect(await screen.findByText("N+1 query")).toBeInTheDocument();
  });

  it("lists findings CRITICAL → WARNING → SUGGESTION with file, line and count", async () => {
    usePrReviews.mockReturnValue(
      reviewsResult({
        data: [
          { findings: [finding({ id: "f1", severity: "SUGGESTION", title: "Suggested" })] },
          {
            findings: [
              finding({ id: "f2", severity: "WARNING", title: "Warned" }),
              finding({ id: "f3", severity: "CRITICAL", title: "Critical", start_line: 5, end_line: 9 }),
            ],
          },
        ] as ReviewRecord[],
      }),
    );
    renderCell(pr({ CRITICAL: 1, WARNING: 1, SUGGESTION: 1 }));
    fireEvent.mouseEnter(screen.getAllByText("1")[0]!);

    const titles = await screen.findAllByText(/Critical|Warned|Suggested/);
    expect(titles.map((n) => n.textContent)).toEqual(["Critical", "Warned", "Suggested"]);
    // Header counts every finding across every review on the PR.
    expect(screen.getByText("3 findings")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:5-9")).toBeInTheDocument();
  });

  it("surfaces the error state instead of an empty card", async () => {
    usePrReviews.mockReturnValue(reviewsResult({ isError: true }));
    renderCell(pr({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 }));

    fireEvent.mouseEnter(screen.getByText("1"));
    expect(await screen.findByText("Couldn’t load findings.")).toBeInTheDocument();
  });

  it("does not bubble a click in the cell up to the row", async () => {
    const onRowClick = vi.fn();
    render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <div onClick={onRowClick}>
          <FindingsCell pr={pr({ CRITICAL: 1, WARNING: 0, SUGGESTION: 0 })} />
        </div>
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByText("1"));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
