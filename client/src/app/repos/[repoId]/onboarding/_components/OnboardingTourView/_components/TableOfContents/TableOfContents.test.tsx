import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSectionKind } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/onboarding.json";
import { TableOfContents } from "./TableOfContents";

afterEach(cleanup);

const KINDS: OnboardingSectionKind[] = [
  "architecture",
  "critical_paths",
  "routes_and_apis",
  "local_setup",
  "reading_path",
  "first_tasks",
];

function renderToc(activeKind: OnboardingSectionKind | null, onActivate = vi.fn()) {
  return {
    onActivate,
    ...render(
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        <TableOfContents kinds={KINDS} activeKind={activeKind} onActivate={onActivate} />
      </NextIntlClientProvider>,
    ),
  };
}

describe("TableOfContents", () => {
  it("renders all six entries in AC-1 order with Routes and APIs third (AC-36)", () => {
    renderToc("architecture");
    const entries = screen.getAllByRole("button").map((btn) => btn.textContent);
    expect(entries).toEqual([
      "Architecture overview",
      "Critical paths",
      "Routes & APIs",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]);
  });

  it("marks the active entry with aria-current", () => {
    renderToc("critical_paths");
    expect(screen.getByText("Critical paths")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Architecture overview")).not.toHaveAttribute("aria-current");
  });

  it("activating an entry notifies the parent and scrolls its card into view (AC-36)", () => {
    const target = document.createElement("section");
    target.id = "first_tasks";
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);

    const { onActivate } = renderToc("architecture");
    fireEvent.click(screen.getByText("First tasks"));

    expect(onActivate).toHaveBeenCalledWith("first_tasks");
    expect(target.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });

    document.body.removeChild(target);
  });

  it("every entry is a real button — reachable by Tab, activatable by Enter/Space (AC-47)", () => {
    renderToc("architecture");
    for (const btn of screen.getAllByRole("button")) {
      expect(btn.tagName).toBe("BUTTON");
      expect(btn).toHaveAccessibleName();
    }
  });
});
