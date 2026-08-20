import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResult } from "@devdigest/shared";
// 10×`../` reaches `client/` from here: `messages/` sits at the package root,
// two levels above what `@/lib/...` would need. See client/insights/gotchas.md.
import messages from "../../../../../../../../../../messages/en/blast.json";
import briefMessages from "../../../../../../../../../../messages/en/brief.json";
import commonMessages from "../../../../../../../../../../messages/en/common.json";
import { BlastCard } from "./BlastCard";

const useBlastRadius = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/blast", () => ({ useBlastRadius }));

afterEach(cleanup);
beforeEach(() => useBlastRadius.mockReset());

const DATA: BlastRadiusResult = {
  pull_id: "pr1",
  status: "ready",
  reason: null,
  degraded: false,
  indexed_sha: "6c415f1d0745c6e1416d799cfb2803b895dcbfec",
  changed_files: ["src/middleware/ratelimit.ts"],
  symbols: [
    {
      name: "rateLimit",
      kind: "function",
      file: "src/middleware/ratelimit.ts",
      change: "added",
      callers: [
        { file: "src/api/public/index.ts", line: 23, symbol: "publicRouter", rank: 0.9 },
        { file: "src/api/public/webhooks.ts", line: 45, symbol: "webhooks", rank: 0.7 },
      ],
      caller_count: 4,
      endpoints: [{ method: "GET", path: "/api/public/items", file: "src/api/public/index.ts" }],
      crons: ["reset-rate-buckets (hourly)"],
    },
    {
      name: "bucketKey",
      kind: "function",
      file: "src/middleware/ratelimit.ts",
      change: "modified",
      callers: [],
      caller_count: 2,
      endpoints: [],
      crons: [],
    },
  ],
  endpoints: [{ method: "GET", path: "/api/public/items", file: "src/api/public/index.ts" }],
  crons: ["reset-rate-buckets (hourly)"],
  totals: { symbols: 2, added: 1, callers: 14, endpoints: 3, crons: 1 },
  prior_prs: [
    {
      id: "old1",
      number: 470,
      title: "Earlier touch of the same files",
      author: "someone.else",
      updated_at: "2026-08-01T00:00:00.000Z",
      overlapping_files: 2,
    },
  ],
  summary: "2 changed symbols · 14 callers · 3 endpoints · 1 cron/job",
};

function renderCard(props: { repoFullName?: string | null; defaultBranch?: string | null } = {}) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ blast: messages, brief: briefMessages, common: commonMessages }}
    >
      <BlastCard
        prId="pr1"
        repoFullName={props.repoFullName === undefined ? "acme/payments-api" : props.repoFullName}
        defaultBranch={props.defaultBranch === undefined ? "main" : props.defaultBranch}
      />
    </NextIntlClientProvider>,
  );
}

function mockBlast(data: BlastRadiusResult | null, state: { isLoading?: boolean; isError?: boolean } = {}) {
  useBlastRadius.mockReturnValue({
    data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    refetch: vi.fn(),
  });
}

describe("BlastCard", () => {
  it("renders the stat row and the changed symbols with their callers", () => {
    mockBlast(DATA);
    renderCard();

    // with new symbols present the row reads "1 new · 1 touched", not "2 symbols"
    // ("new" appears twice: the stat label and the badge on the added row)
    expect(screen.getAllByText("new").length).toBeGreaterThan(0);
    expect(screen.getByText("touched")).toBeInTheDocument();
    expect(screen.getByText("14")).toBeInTheDocument();

    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
    expect(screen.getByText("bucketKey()")).toBeInTheDocument();
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
    expect(screen.getByText("/api/public/items")).toBeInTheDocument();
    expect(screen.getByText("reset-rate-buckets (hourly)")).toBeInTheDocument();
  });

  it("pins a caller's file:line to the sha the index was built from", () => {
    mockBlast(DATA);
    renderCard();

    const link = screen.getByText("src/api/public/index.ts:23");
    // Neither the PR head sha nor `main`: the line number came out of the index,
    // so only the indexed sha guarantees the link lands on that line.
    expect(link).toHaveAttribute(
      "href",
      `https://github.com/acme/payments-api/blob/${DATA.indexed_sha}/src/api/public/index.ts#L23`,
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("falls back to the default branch when there is no indexed sha", () => {
    mockBlast({ ...DATA, indexed_sha: null });
    renderCard();

    expect(screen.getByText("src/api/public/index.ts:23")).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/api/public/index.ts#L23",
    );
  });

  it("renders file:line as plain text, not a dead link, before the repo resolves", () => {
    mockBlast({ ...DATA, indexed_sha: null });
    renderCard({ repoFullName: null, defaultBranch: null });

    expect(screen.getByText("src/api/public/index.ts:23").tagName).toBe("BUTTON");
  });

  it("says how many callers were withheld when the list is capped", () => {
    mockBlast(DATA);
    renderCard();

    // 2 shown of 4 known — a bare "2" would understate the reach.
    expect(screen.getByText("2 of 4 callers")).toBeInTheDocument();
  });

  it("toggles between the tree and the graph view", () => {
    mockBlast(DATA);
    renderCard();

    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "graph" }));
    expect(screen.queryByText("src/api/public/index.ts:23")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Blast radius graph" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "tree" }));
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
  });

  it("collapses and expands a symbol's callers", () => {
    mockBlast(DATA);
    renderCard();

    const header = screen.getByRole("button", { name: "Hide callers of rateLimit" });
    fireEvent.click(header);
    expect(screen.queryByText("src/api/public/index.ts:23")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show callers of rateLimit" }));
    expect(screen.getByText("src/api/public/index.ts:23")).toBeInTheDocument();
  });

  it("shows prior PRs touching the same files behind a disclosure", () => {
    mockBlast(DATA);
    renderCard();

    expect(screen.queryByText("Earlier touch of the same files")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Prior PRs touching these files/ }));

    const item = screen.getByText("Earlier touch of the same files");
    expect(item).toHaveAttribute("href", "https://github.com/acme/payments-api/pull/470");
  });

  it("banners a partial index above the data instead of hiding it", () => {
    mockBlast({
      ...DATA,
      status: "partial",
      reason: "the index is partial — 12 file(s) were skipped. Callers may be missing.",
    });
    renderCard();

    const banner = screen.getByRole("status");
    expect(within(banner).getByText("Partial map")).toBeInTheDocument();
    expect(banner).toHaveTextContent("12 file(s) were skipped");
    // the map itself is still on screen — partial is not "nothing"
    expect(screen.getByText("rateLimit()")).toBeInTheDocument();
  });

  it("explains a degraded index rather than rendering an empty map", () => {
    mockBlast({
      ...DATA,
      status: "degraded",
      degraded: true,
      reason: "This repo has not been indexed yet.",
      symbols: [],
      totals: { symbols: 0, added: 0, callers: 0, endpoints: 0, crons: 0 },
    });
    renderCard();

    expect(screen.getByText("No impact map yet")).toBeInTheDocument();
    expect(screen.getByText("This repo has not been indexed yet.")).toBeInTheDocument();
    // crucially NOT a zeroed stat row, which would read as "nothing is affected"
    expect(screen.queryByText("callers")).not.toBeInTheDocument();
  });

  it("renders an inline error with a retry, never a full-screen one", () => {
    mockBlast(null, { isError: true });
    renderCard();

    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the blast radius.");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows a skeleton while loading", () => {
    mockBlast(null, { isLoading: true });
    const { container } = renderCard();

    expect(screen.queryByText("rateLimit()")).not.toBeInTheDocument();
    expect(container.querySelectorAll("div").length).toBeGreaterThan(0);
  });
});

describe("BlastCard — added vs touched", () => {
  it("badges the symbols the PR introduces", () => {
    mockBlast(DATA);
    renderCard();
    // exactly one badge: rateLimit is `added`, bucketKey is `modified`
    expect(screen.getAllByText("new")).toHaveLength(2); // stat label + row badge
  });

  it("shows a plain symbol count when nothing is new", () => {
    mockBlast({
      ...DATA,
      symbols: DATA.symbols.map((s) => ({ ...s, change: "modified" as const })),
      totals: { ...DATA.totals, added: 0 },
    });
    renderCard();
    expect(screen.getByText("symbols")).toBeInTheDocument();
    expect(screen.queryByText("touched")).not.toBeInTheDocument();
  });
});
