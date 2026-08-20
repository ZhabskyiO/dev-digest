import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/context.json";
import { AttachmentList, type AttachmentListItem } from "./AttachmentList";

afterEach(cleanup);

function renderList(items: AttachmentListItem[], overrides: Partial<Parameters<typeof AttachmentList>[0]> = {}) {
  const onToggle = overrides.onToggle ?? vi.fn();
  return {
    onToggle,
    ...render(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <AttachmentList items={items} onToggle={onToggle} {...overrides} />
      </NextIntlClientProvider>,
    ),
  };
}

describe("AttachmentList", () => {
  it("makes every row a keyboard-reachable checkbox whose name carries the path and token estimate, toggling on activation", () => {
    const onToggle = vi.fn();
    renderList(
      [
        { path: "specs/security-baseline.md", type: "specs", tokens: 139, checked: true },
        { path: "specs/public-api.md", type: "specs", tokens: 178, checked: false },
      ],
      { onToggle },
    );

    // Accessible name carries both the clone-relative path and the ≈ token estimate.
    const row = screen.getByRole("checkbox", { name: /specs\/public-api\.md.*≈ 178 tokens/ });

    // A real <button> is part of the natural tab order for free (no tabindex=-1,
    // no div-with-onClick) — that IS what makes it keyboard reachable.
    expect(row.tagName).toBe("BUTTON");
    expect(row).not.toHaveAttribute("tabindex", "-1");
    row.focus();
    expect(row).toHaveFocus();

    // A native <button>'s default action fires a click on Space/Enter — the
    // same handler this exercises via fireEvent.click (no @testing-library/user-event
    // in this repo; see client/insights/gotchas.md).
    expect(row).toHaveAttribute("aria-checked", "false");
    fireEvent.click(row);
    expect(onToggle).toHaveBeenCalledWith("specs/public-api.md");

    const checkedRow = screen.getByRole("checkbox", { name: /specs\/security-baseline\.md.*≈ 139 tokens/ });
    expect(checkedRow).toHaveAttribute("aria-checked", "true");
  });

  it("never renders a token figure without the ≈ approximation marker (AC-9)", () => {
    renderList([
      { path: "docs/architecture.md", type: "docs", tokens: 812, checked: false },
      { path: "insights/perf-budget.md", type: "insights", tokens: 4, checked: true, drift: true, usedByAgents: 2 },
    ]);

    const tokenNodes = screen.getAllByText(/\d+ tokens?$/);
    expect(tokenNodes.length).toBeGreaterThan(0);
    for (const node of tokenNodes) {
      expect(node.textContent).toMatch(/≈/);
    }
  });

  it("exposes reordering through a FOCUSABLE drag handle — the arrows are gone, but the keyboard path is not", () => {
    renderList(
      [
        { path: "specs/a.md", type: "specs", tokens: 10, checked: true },
        { path: "specs/b.md", type: "specs", tokens: 20, checked: true },
      ],
      { onReorder: vi.fn() },
    );

    // The old Move up / Move down pair is gone…
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();

    // …and what replaced it is a real button, not a decorative glyph: that is
    // what keeps dnd-kit's KeyboardSensor reachable by Tab. A <span> here
    // would make reordering pointer-only and silently fail WCAG.
    const handle = screen.getByRole("button", { name: /Reorder a\.md/ });
    expect(handle.tagName).toBe("BUTTON");
    handle.focus();
    expect(handle).toHaveFocus();
  });

  // A full drag is not simulated here: dnd-kit's sensors read layout via
  // getBoundingClientRect, which jsdom reports as all-zero, so no drop target
  // is ever resolved and onDragEnd never fires. SkillsTab (this repo's other
  // sortable list) makes the same call. What the drag COMPUTES is covered as
  // pure functions instead — see each ContextTab's helpers.test.ts.

  it("renders no drag handle on a browse list (no onReorder) — order is meaningless there", () => {
    renderList([{ path: "specs/a.md", type: "specs", tokens: 10, checked: false }]);
    expect(screen.queryByRole("button", { name: /Reorder / })).toBeNull();
  });
});
