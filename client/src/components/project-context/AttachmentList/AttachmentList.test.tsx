import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/context.json";
import { AttachmentList, resolveDragReorder, type AttachmentListItem } from "./AttachmentList";

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
    // Reports the row's FULL identity (the whole item), not just its path —
    // a caller with two same-path rows across different repos needs
    // `repo_id` to know which one was clicked (see the M1/M2 test below).
    expect(onToggle).toHaveBeenCalledWith(
      expect.objectContaining({ path: "specs/public-api.md", checked: false }),
    );

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

  it("keys rows on repo_id + path so two repos sharing a path render distinctly and toggle independently (M1)", () => {
    const onToggle = vi.fn();
    const items: AttachmentListItem[] = [
      { path: "specs/shared.md", repo_id: "repo-a", type: "specs", tokens: 10, checked: false },
      { path: "specs/shared.md", repo_id: "repo-b", type: "specs", tokens: 10, checked: false },
    ];
    const { rerender } = renderList(items, { onToggle });

    // Both rows exist — no collision collapsed them into one.
    const rows = screen.getAllByRole("checkbox", { name: /specs\/shared\.md/ });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveAttribute("aria-checked", "false");
    expect(rows[1]).toHaveAttribute("aria-checked", "false");

    fireEvent.click(rows[0]!);
    // Reports the FULL clicked row — repo_id AND path — so a caller with two
    // same-path rows from different repos can tell them apart. Asserting on
    // identity, not just "was called with this path": a caller told only the
    // path could not distinguish this call from a click on `rows[1]`.
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ path: "specs/shared.md", repo_id: "repo-a" }));
    onToggle.mockClear();

    fireEvent.click(rows[1]!);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ path: "specs/shared.md", repo_id: "repo-b" }));

    // Simulate the caller applying that toggle only to the repo-a item —
    // this is the scenario a colliding `key={item.path}` would get wrong,
    // reusing one row's DOM/state for the other on re-render.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ context: messages }}>
        <AttachmentList
          items={[{ ...items[0]!, checked: true }, items[1]!]}
          onToggle={onToggle}
        />
      </NextIntlClientProvider>,
    );

    const updatedRows = screen.getAllByRole("checkbox", { name: /specs\/shared\.md/ });
    expect(updatedRows).toHaveLength(2);
    expect(updatedRows[0]).toHaveAttribute("aria-checked", "true");
    expect(updatedRows[1]).toHaveAttribute("aria-checked", "false");
  });

  // Drag reorder is proven as a pure function (`resolveDragReorder`), not via
  // a simulated pointer drag — see the note above on why jsdom can't resolve
  // a real dnd-kit drop target. This is the id-resolution half of the fix:
  // `useSortable`/`SortableContext` are given `repo_id:path` ids (matching
  // the React key), not bare `path` — see `AttachmentList.tsx`'s `itemKey`.
  it("drags the correct row by repo_id + path when two attached docs share a path (dnd-kit id collision)", () => {
    const items: AttachmentListItem[] = [
      { path: "specs/shared.md", repo_id: "repo-a", type: "specs", tokens: 10, checked: true },
      { path: "specs/other.md", repo_id: "repo-a", type: "specs", tokens: 20, checked: true },
      { path: "specs/shared.md", repo_id: "repo-b", type: "specs", tokens: 30, checked: true },
    ];

    // Drag the repo-b "shared.md" row (index 2) to land just before "other.md"
    // (index 1). The repo-a "shared.md" row (index 0) is not part of this
    // drag and must stay exactly where it was.
    const next = resolveDragReorder(items, "repo-b:specs/shared.md", "repo-a:specs/other.md");

    // repo-a's shared.md (untouched) stays first; repo-b's shared.md moves to
    // sit where "other.md" was; "other.md" is pushed one slot down. A
    // `path`-only id would have resolved BOTH "shared.md" occurrences to
    // index 0 via `indexOf`, dragging the repo-a row instead and producing
    // ["specs/other.md", "specs/shared.md", "specs/shared.md"] — a different,
    // wrong result from the one asserted below.
    expect(next).toEqual(["specs/shared.md", "specs/shared.md", "specs/other.md"]);
  });

  it("drag reorder is a no-op when the active/over ids don't resolve to two distinct rows", () => {
    const items: AttachmentListItem[] = [
      { path: "specs/a.md", repo_id: "repo-a", type: "specs", tokens: 10, checked: true },
    ];

    expect(resolveDragReorder(items, "repo-a:specs/a.md", "repo-a:specs/a.md")).toBeNull();
    expect(resolveDragReorder(items, "repo-x:missing.md", "repo-a:specs/a.md")).toBeNull();
  });
});
