import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrBriefDetail, PrCommit } from "@devdigest/shared";
// 10×`../` reaches `client/` from here: `messages/` sits at the package root,
// two levels above what `@/lib/...` would need. See client/insights/gotchas.md.
import messages from "../../../../../../../../../../messages/en/brief.json";
import commonMessages from "../../../../../../../../../../messages/en/common.json";
import { BriefCard } from "./BriefCard";

const usePrBrief = vi.hoisted(() => vi.fn());
const useGenerateBrief = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/brief", () => ({ usePrBrief, useGenerateBrief }));

afterEach(cleanup);
beforeEach(() => {
  usePrBrief.mockReset();
  useGenerateBrief.mockReset();
});

const HEAD = "sha-head-3";

/** Oldest-first, HEAD last — GitHub's `pulls.listCommits` ordering. */
const COMMITS: PrCommit[] = [
  { sha: "sha-head-1", message: "first", author: "octocat" },
  { sha: "sha-head-2", message: "second", author: "octocat" },
  { sha: HEAD, message: "third", author: "octocat" },
];

function brief(over: Partial<PrBriefDetail> = {}): PrBriefDetail {
  return {
    pr_id: "pr1",
    head_sha: HEAD,
    status: "ready",
    reason: null,
    intent: null,
    blast: null,
    verdict_summary: null,
    review_focus: [],
    cost_usd: 0.0042,
    tokens_in: 1200,
    tokens_out: 300,
    generated_at: "2026-08-20T12:00:00.000Z",
    summarized_files: 3,
    changed_files: 5,
    ...over,
  };
}

/** A `useMutation`-shaped stub; `mutate` is what the tests assert on. */
function mutation(over: Partial<{ isPending: boolean; isError: boolean }> = {}) {
  return {
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    ...over,
  };
}

function renderCard(opts: { data: PrBriefDetail | null; isLoading?: boolean; generate?: ReturnType<typeof mutation> }) {
  usePrBrief.mockReturnValue({ data: opts.data, isLoading: opts.isLoading ?? false });
  const generate = opts.generate ?? mutation();
  useGenerateBrief.mockReturnValue(generate);
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages, common: commonMessages }}>
      <BriefCard
        prId="pr1"
        prHeadSha={HEAD}
        prCommits={COMMITS}
        repoFullName="acme/payments-api"
        onOpenFileLine={() => {}}
        blastSlot={<div data-testid="blast-slot" />}
      />
    </NextIntlClientProvider>,
  );
  return { ...view, generate };
}

describe("BriefCard", () => {
  it("AC-2: with no brief, renders the empty state and exactly one enabled `Generate brief` control that posts WITHOUT force", () => {
    const { generate } = renderCard({ data: null });

    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: /generate brief/i });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toBeEnabled();
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
    // The blast slot still renders next to the empty state — it is not part
    // of the brief.
    expect(screen.getByTestId("blast-slot")).toBeInTheDocument();

    fireEvent.click(buttons[0]!);
    expect(generate.mutate).toHaveBeenCalledTimes(1);
    expect(generate.mutate).toHaveBeenCalledWith({ force: false });
  });

  it("with a current brief, renders a `Regenerate brief` control that posts force=true, and no stale notice", () => {
    const { generate } = renderCard({ data: brief() });

    const regenerate = screen.getByRole("button", { name: /regenerate brief/i });
    expect(regenerate).toBeEnabled();
    expect(screen.queryByText("No brief yet")).toBeNull();
    expect(screen.queryByText("This brief is out of date")).toBeNull();

    fireEvent.click(regenerate);
    expect(generate.mutate).toHaveBeenCalledTimes(1);
    expect(generate.mutate).toHaveBeenCalledWith({ force: true });
  });

  it("AC-12/AC-45: with a stale brief, the stale notice names the commit count and HOSTS the single Regenerate control", () => {
    const { generate } = renderCard({ data: brief({ head_sha: "sha-head-1" }) });

    const notice = screen.getByRole("status");
    expect(within(notice).getByText("This brief is out of date")).toBeInTheDocument();
    expect(within(notice).getByText(/2 commits have landed/)).toBeInTheDocument();

    // The regenerate action lives inside the notice, and there is exactly one
    // of it in the whole card (AC-43).
    const inNotice = within(notice).getByRole("button", { name: /regenerate brief/i });
    expect(screen.getAllByRole("button", { name: /regenerate brief/i })).toHaveLength(1);

    fireEvent.click(inNotice);
    expect(generate.mutate).toHaveBeenCalledWith({ force: true });
    // The stale brief's content stays visible underneath the notice.
    expect(screen.getByText("3 of 5 files summarized")).toBeInTheDocument();
  });

  it("falls back to the generic stale copy when the brief's sha is not in the commit list (rebase)", () => {
    renderCard({ data: brief({ head_sha: "sha-rewritten-away" }) });
    expect(screen.getByText(/New commits have landed/)).toBeInTheDocument();
  });

  it("AC-4: while generation is pending, the control is disabled and shows the in-flight label", () => {
    renderCard({ data: brief(), generate: mutation({ isPending: true }) });
    const button = screen.getByRole("button", { name: /generating/i });
    expect(button).toBeDisabled();
  });

  it("AC-7: a failed regenerate shows an inline, dismissible alert and keeps the previous brief rendered", () => {
    const generate = mutation({ isError: true });
    renderCard({ data: brief(), generate });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/couldn't generate the brief/i);
    expect(screen.getByText("3 of 5 files summarized")).toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: /dismiss/i }));
    expect(generate.reset).toHaveBeenCalledTimes(1);
  });
});
