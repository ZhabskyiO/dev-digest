import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/context.json";
import { DriftCompare } from "./DriftCompare";
import { DIFF_MAX_LINES } from "./helpers";

afterEach(cleanup);

function renderDriftCompare(props: Partial<React.ComponentProps<typeof DriftCompare>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ context: messages }}>
      <DriftCompare current="a\nb" previousUnavailable={false} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("DriftCompare", () => {
  it("falls back to showing the current content only when the previous version is unavailable", () => {
    renderDriftCompare({ previous: undefined, previousUnavailable: true, current: "a\nb\nc" });

    expect(screen.getByText(messages.drift.detail.previousUnavailable)).toBeInTheDocument();
    // No diff markers — every visible line is plain current content.
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.queryByText(messages.drift.detail.truncatedNote)).not.toBeInTheDocument();
  });

  it("renders no truncation notice for a normal-sized diff", () => {
    renderDriftCompare({ previous: "a\nb", previousUnavailable: false, current: "a\nc" });

    expect(screen.queryByText(messages.drift.detail.truncatedNote)).not.toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.getByText("c")).toBeInTheDocument();
  });

  it("renders the truncation notice when either side exceeds the diff budget", () => {
    const big = Array.from({ length: DIFF_MAX_LINES + 500 }, (_, i) => `line-${i}`).join("\n");
    const bigChanged = Array.from({ length: DIFF_MAX_LINES + 500 }, (_, i) => `line-${i}-x`).join("\n");

    renderDriftCompare({ previous: big, previousUnavailable: false, current: bigChanged });

    expect(screen.getByText(messages.drift.detail.truncatedNote)).toBeInTheDocument();
  });
});
