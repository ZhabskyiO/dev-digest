import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentDetail } from "@devdigest/shared";
// 10×`../` reaches `client/` from here: `messages/` sits at the package root,
// two levels above what `@/lib/...` would need. See client/insights/gotchas.md.
import messages from "../../../../../../../../../../messages/en/brief.json";
import commonMessages from "../../../../../../../../../../messages/en/common.json";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

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

function renderCard(intent: PrIntentDetail | null) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages, common: commonMessages }}>
      <IntentCard intent={intent} repoFullName="acme/widgets" headSha="abc1234" />
    </NextIntlClientProvider>,
  );
}

describe("IntentCard", () => {
  it("renders the statement in quotation marks, both scope columns, and risk chips", () => {
    renderCard(INTENT);

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
    renderCard({ ...INTENT, risk_areas: [] });

    expect(screen.queryByText("Risk areas")).not.toBeInTheDocument();
    expect(screen.getByText("In scope")).toBeInTheDocument();
  });

  it("warns that scope was withheld from the reviewer only at low confidence", () => {
    renderCard({ ...INTENT, confidence: { tier: "low", score: 0.3, sources: ["title"] } });
    expect(screen.getByText(/were not shown to the reviewer/)).toBeInTheDocument();

    cleanup();
    renderCard(INTENT);
    expect(screen.queryByText(/were not shown to the reviewer/)).not.toBeInTheDocument();
  });

  it("shows the empty state, not the card, when no intent has been derived", () => {
    renderCard(null);
    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.queryByText("In scope")).not.toBeInTheDocument();
  });

  it("carries no recalculate/re-derive control of its own (AC-43)", () => {
    // Scoped to the specific control AC-43 removed, not "no buttons at all" —
    // this fixture's risk areas carry no `explanation`, but AC-17 requires a
    // real `<button>` disclosure on any risk area that does, and that must
    // stay unaffected by this assertion.
    renderCard(INTENT);
    expect(
      screen.queryByRole("button", { name: /re-derive|recalculate/i }),
    ).not.toBeInTheDocument();

    cleanup();
    renderCard(null);
    expect(
      screen.queryByRole("button", { name: /re-derive|recalculate/i }),
    ).not.toBeInTheDocument();
  });
});
