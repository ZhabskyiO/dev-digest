import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Conflict } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/runs.json";
import { DisagreementBlock } from "./DisagreementBlock";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const UNANIMOUS: Conflict = {
  file: "src/a.ts",
  start_line: 10,
  end_line: 14,
  title: "Unhandled rejection",
  takes: [
    { agent_id: "a1", agent_name: "Agent One", verdict: "WARNING", note: null },
    { agent_id: "a2", agent_name: "Agent Two", verdict: "WARNING", note: null },
  ],
};

const DIVERGENT: Conflict = {
  file: "src/b.ts",
  start_line: 20,
  end_line: 25,
  title: "Possible SQL injection",
  takes: [
    { agent_id: "a1", agent_name: "Agent One", verdict: "CRITICAL", note: null },
    { agent_id: "a2", agent_name: "Agent Two", verdict: "ignored", note: "outside diff hunk" },
  ],
};

const NOTELESS_IGNORED: Conflict = {
  file: "src/c.ts",
  start_line: 1,
  end_line: 2,
  title: "Missing null check",
  takes: [
    { agent_id: "a1", agent_name: "Agent One", verdict: "SUGGESTION", note: null },
    { agent_id: "a2", agent_name: "Agent Two", verdict: "ignored", note: null },
  ],
};

describe("DisagreementBlock", () => {
  it("hides a unanimous group and keeps a divergent group when the toggle is on (AC-29)", () => {
    renderWithIntl(<DisagreementBlock conflicts={[UNANIMOUS, DIVERGENT]} />);

    expect(screen.getByText("Unhandled rejection")).toBeInTheDocument();
    expect(screen.getByText("Possible SQL injection")).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Show only conflicts" });
    fireEvent.click(toggle);

    expect(screen.queryByText("Unhandled rejection")).not.toBeInTheDocument();
    expect(screen.getByText("Possible SQL injection")).toBeInTheDocument();
  });

  it("renders an empty state for a zero-conflict fixture, never disappearing (AC-45)", () => {
    renderWithIntl(<DisagreementBlock conflicts={[]} />);

    expect(screen.getByText("No disagreements")).toBeInTheDocument();
    expect(screen.getByText("The agents agree on every flagged location.")).toBeInTheDocument();
    // The block itself — its heading — stays in the document.
    expect(screen.getByText("Where agents disagree")).toBeInTheDocument();
  });

  it("renders a group label containing markup as inert visible text (AC-48)", () => {
    const withMarkup: Conflict = {
      ...UNANIMOUS,
      title: '<img src=x onerror="alert(1)">Injected label',
    };
    const { container } = renderWithIntl(<DisagreementBlock conflicts={[withMarkup]} />);

    expect(
      screen.getByText('<img src=x onerror="alert(1)">Injected label'),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("exposes aria-pressed on the toggle and is keyboard-reachable", () => {
    renderWithIntl(<DisagreementBlock conflicts={[DIVERGENT]} />);
    const toggle = screen.getByRole("button", { name: "Show only conflicts" });

    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle.tagName).toBe("BUTTON");
    toggle.focus();
    expect(toggle).toHaveFocus();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a take's note only when present, and a note-less ignored take shows just the marker (AC-50)", () => {
    renderWithIntl(<DisagreementBlock conflicts={[DIVERGENT, NOTELESS_IGNORED]} />);

    expect(screen.getByText("outside diff hunk")).toBeInTheDocument();

    const missingNullCheckLabel = screen.getByText("Missing null check");
    const noteless = missingNullCheckLabel.closest("div");
    expect(noteless).not.toBeNull();
    expect(screen.getAllByText("did not flag").length).toBeGreaterThan(0);
  });
});
