import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentDetail } from "@devdigest/shared";
// 10×`../` reaches `client/` from here: `messages/` sits at the package root,
// two levels above what `@/lib/...` would need. See client/insights.md.
import messages from "../../../../../../../../../../messages/en/brief.json";
import commonMessages from "../../../../../../../../../../messages/en/common.json";
import { IntentCard } from "./IntentCard";

const usePrIntent = vi.hoisted(() => vi.fn());
const useRecalculateIntent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/reviews", () => ({ usePrIntent, useRecalculateIntent }));

/** The re-derive mutation's return, with the mutate spy the tests assert on. */
const mutate = vi.fn();
function mockRecalculate(state: { isPending?: boolean; isError?: boolean } = {}) {
  useRecalculateIntent.mockReturnValue({
    mutate,
    isPending: state.isPending ?? false,
    isError: state.isError ?? false,
  });
}

afterEach(cleanup);
beforeEach(() => {
  usePrIntent.mockReset();
  useRecalculateIntent.mockReset();
  mutate.mockReset();
  mockRecalculate();
});

const INTENT: PrIntentDetail = {
  intent: "Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.",
  in_scope: ["Add middleware for rate limiting", "Apply to /api/public/* routes"],
  out_of_scope: ["Authentication changes", "Adding new endpoints"],
  risk_areas: [
    { kind: "security", label: "Auth surface touched" },
    { kind: "dependency", label: "New dependency: ioredis" },
    { kind: "performance", label: "Adds Redis round-trip per request" },
  ],
  pr_id: "pr1",
  head_sha: "abc1234",
  confidence: { tier: "high", score: 0.9, sources: ["title", "ticket", "spec_doc"] },
  provider: "anthropic",
  model: "claude-haiku-4-5-20251001",
  cost_usd: 0.0012,
  derived_at: "2026-08-08T12:00:00.000Z",
};

function renderCard() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages, common: commonMessages }}>
      <IntentCard prId="pr1" />
    </NextIntlClientProvider>,
  );
}

function mockIntent(data: PrIntentDetail | null) {
  usePrIntent.mockReturnValue({ data, isLoading: false, isError: false, refetch: vi.fn() });
}

describe("IntentCard", () => {
  it("renders the statement in quotation marks, both scope columns, and risk chips", () => {
    mockIntent(INTENT);
    renderCard();

    // The quotes are part of the rendered text — they mark the sentence as the
    // author's claim, so a plain-substring match must fail without them.
    expect(screen.getByText(`“${INTENT.intent}”`)).toBeInTheDocument();

    expect(screen.getByText("In scope")).toBeInTheDocument();
    expect(screen.getByText("Out of scope")).toBeInTheDocument();
    expect(screen.getByText("Add middleware for rate limiting")).toBeInTheDocument();
    expect(screen.getByText("Authentication changes")).toBeInTheDocument();

    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    for (const area of INTENT.risk_areas) {
      expect(screen.getByText(area.label)).toBeInTheDocument();
    }
  });

  it("omits the risk-areas section entirely when the model returned none", () => {
    mockIntent({ ...INTENT, risk_areas: [] });
    renderCard();

    expect(screen.queryByText("Risk areas")).not.toBeInTheDocument();
    expect(screen.getByText("In scope")).toBeInTheDocument();
  });

  it("warns that scope was withheld from the reviewer only at low confidence", () => {
    mockIntent({ ...INTENT, confidence: { tier: "low", score: 0.3, sources: ["title"] } });
    renderCard();
    expect(screen.getByText(/were not shown to the reviewer/)).toBeInTheDocument();

    cleanup();
    mockIntent(INTENT);
    renderCard();
    expect(screen.queryByText(/were not shown to the reviewer/)).not.toBeInTheDocument();
  });

  it("shows the empty state, not the card, when no intent has been derived", () => {
    mockIntent(null);
    renderCard();
    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.queryByText("In scope")).not.toBeInTheDocument();
  });

  describe("re-derive", () => {
    it("triggers the mutation from both the card and the empty state", () => {
      mockIntent(INTENT);
      renderCard();
      fireEvent.click(screen.getByRole("button", { name: "Re-derive" }));
      expect(mutate).toHaveBeenCalledTimes(1);

      // The empty state is the one place this button is the ONLY way forward —
      // otherwise leaving it means running a whole review.
      cleanup();
      mockIntent(null);
      renderCard();
      fireEvent.click(screen.getByRole("button", { name: "Re-derive" }));
      expect(mutate).toHaveBeenCalledTimes(2);
    });

    it("disables the button while a derivation is in flight", () => {
      mockIntent(INTENT);
      mockRecalculate({ isPending: true });
      renderCard();

      const button = screen.getByRole("button", { name: "Deriving…" });
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(mutate).not.toHaveBeenCalled();
    });

    it("reports a failed re-derive while keeping the stored intent on screen", () => {
      mockIntent(INTENT);
      mockRecalculate({ isError: true });
      renderCard();

      expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't re-derive/);
      // The POST failing says nothing about what is already stored.
      expect(screen.getByText(`“${INTENT.intent}”`)).toBeInTheDocument();
    });
  });
});
