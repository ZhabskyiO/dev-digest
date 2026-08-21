import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, PrFile, SmartDiff } from "@devdigest/shared";
// 8×`../` reaches `client/` from here — same depth as the sibling
// FindingCard test. `messages/` sits at the package root, one level above
// `src/`. See client/insights/gotchas.md.
import prReview from "../../../../../../../../messages/en/prReview.json";
import shell from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

const useSmartDiff = vi.hoisted(() => vi.fn());
const usePrReviews = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/reviews", () => ({ useSmartDiff, usePrReviews }));

afterEach(cleanup);

const PATCH = ["@@ -1,3 +1,5 @@", " const a = 1;", "+const b = 2;", "+const c = 3;"].join("\n");

const FILES: PrFile[] = [
  { path: "src/middleware/ratelimit.ts", additions: 2, deletions: 0, patch: PATCH },
  { path: "src/api/public/index.ts", additions: 2, deletions: 0, patch: PATCH },
  { path: "package-lock.json", additions: 2, deletions: 0, patch: PATCH },
];

const SMART: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        {
          path: "src/middleware/ratelimit.ts",
          additions: 2,
          deletions: 0,
          finding_lines: [3],
          pseudocode_summary: null,
        },
      ],
    },
    {
      role: "wiring",
      files: [
        {
          path: "src/api/public/index.ts",
          additions: 2,
          deletions: 0,
          finding_lines: [],
          pseudocode_summary: null,
        },
      ],
    },
    {
      role: "boilerplate",
      files: [
        {
          path: "package-lock.json",
          additions: 2,
          deletions: 0,
          finding_lines: [],
          pseudocode_summary: null,
        },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 6, proposed_splits: [] },
};

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Missing expiry on the bucket key",
  file: "src/middleware/ratelimit.ts",
  start_line: 3,
  end_line: 3,
  rationale: "…",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderViewer(
  onSelectFinding?: (f: { id: string }) => void,
  target?: { path: string; line: number } | null,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, shell }}>
      <SmartDiffViewer
        prId="pr1"
        files={FILES}
        {...(onSelectFinding ? { onSelectFinding } : {})}
        {...(target ? { target } : {})}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  useSmartDiff.mockReset();
  usePrReviews.mockReset();
  useSmartDiff.mockReturnValue({ data: SMART, isLoading: false });
  usePrReviews.mockReturnValue({
    data: [{ id: "r1", agent_id: "a1", run_id: "run1", findings: [FINDING] }],
  });
  // jsdom implements neither; the component calls both on a badge click.
  Element.prototype.scrollIntoView = vi.fn();
});

describe("SmartDiffViewer", () => {
  it("renders the three groups in reviewer order with their hints", () => {
    renderViewer();
    const labels = screen.getAllByText(/Core logic|Wiring|Boilerplate/);
    expect(labels.map((el) => el.textContent)).toEqual(["Core logic", "Wiring", "Boilerplate"]);
    expect(screen.getByText("The substance of the change — review closely")).toBeInTheDocument();
    expect(screen.getByText("Generated / mechanical — skim")).toBeInTheDocument();
  });

  it("starts the lockfile collapsed and the core file with a finding expanded", () => {
    const { container } = renderViewer();
    // An expanded card renders its patch text; a collapsed one renders none.
    const code = container.textContent ?? "";
    expect(code).toContain("const b = 2;");
    // Only the core file is open, so exactly one copy of the shared patch body
    // is in the DOM — the lockfile and the wiring barrel are both collapsed.
    expect(code.split("const b = 2;").length - 1).toBe(1);
  });

  it("shows a findings badge only on files that have findings", () => {
    renderViewer();
    const badges = screen.getAllByText("1 finding");
    expect(badges).toHaveLength(1);
  });

  it("expands the file and scrolls to the line when the badge is clicked", () => {
    renderViewer();
    const badge = screen.getByTitle("Jump to the first finding in this file");
    fireEvent.click(badge);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("hands the clicked finding to onSelectFinding from a line severity badge", () => {
    const onSelectFinding = vi.fn();
    renderViewer(onSelectFinding);
    // The line badge is titled with the finding's own title, which
    // distinguishes it from the file-header "jump to first finding" button.
    fireEvent.click(screen.getByTitle(FINDING.title));
    expect(onSelectFinding).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f1", severity: "CRITICAL" }),
    );
  });

  it("renders line badges as plain labels when no handler is given", () => {
    renderViewer();
    const badge = screen.getByTitle(FINDING.title);
    expect(badge.tagName).toBe("SPAN");
  });

  it("renders the split suggestion only when the PR is too big", () => {
    renderViewer();
    expect(screen.queryByText(/This PR is large/)).not.toBeInTheDocument();

    cleanup();
    useSmartDiff.mockReturnValue({
      data: {
        ...SMART,
        split_suggestion: {
          too_big: true,
          total_lines: 900,
          proposed_splits: [{ name: "src/api", files: ["a.ts", "b.ts"] }],
        },
      },
      isLoading: false,
    });
    renderViewer();
    expect(screen.getByText(/This PR is large \(900 changed lines\)/)).toBeInTheDocument();
    expect(screen.getByText("src/api")).toBeInTheDocument();
  });

  it("renders groups with no badges before any review has run", () => {
    usePrReviews.mockReturnValue({ data: [] });
    useSmartDiff.mockReturnValue({
      data: {
        ...SMART,
        groups: SMART.groups.map((g) => ({
          ...g,
          files: g.files.map((f) => ({ ...f, finding_lines: [] })),
        })),
      },
      isLoading: false,
    });
    renderViewer();
    expect(screen.getByText("Core logic")).toBeInTheDocument();
    expect(screen.queryByText(/findings/)).not.toBeInTheDocument();
  });

  it("shows the summary pill only on a file that carries a summary, and it is not a button (AC-44)", () => {
    useSmartDiff.mockReturnValue({
      data: {
        ...SMART,
        groups: SMART.groups.map((g) =>
          g.role === "core"
            ? {
                ...g,
                files: g.files.map((f) => ({ ...f, pseudocode_summary: "Rate-limits by IP." })),
              }
            : g,
        ),
      },
      isLoading: false,
    });
    renderViewer();
    expect(screen.getAllByText("summary")).toHaveLength(1);
    const pill = screen.getByText("summary");
    expect(pill.tagName).not.toBe("BUTTON");
    expect(pill.getAttribute("tabindex")).toBeNull();
    // Not a button anywhere in the accessibility tree either.
    expect(screen.queryByRole("button", { name: "summary" })).not.toBeInTheDocument();
  });

  it('renders the "N of M files summarized" note only when some but not all files carry a summary (AC-37)', () => {
    useSmartDiff.mockReturnValue({
      data: {
        ...SMART,
        groups: SMART.groups.map((g) =>
          g.role === "core"
            ? {
                ...g,
                files: g.files.map((f) => ({ ...f, pseudocode_summary: "Rate-limits by IP." })),
              }
            : g,
        ),
      },
      isLoading: false,
    });
    renderViewer();
    expect(screen.getByText("1 of 3 files summarized")).toBeInTheDocument();
  });

  it('omits the "files summarized" note when no file carries a summary (AC-37)', () => {
    // Default SMART fixture has `pseudocode_summary: null` on every file.
    renderViewer();
    expect(screen.queryByText(/files summarized/)).not.toBeInTheDocument();
  });

  it("expands the target file and scrolls to its line on arrival (AC-26)", () => {
    // The lockfile is boilerplate, so it never auto-expands — proving this
    // target reaches it (rather than one already open) is the real test.
    const { container } = renderViewer(undefined, { path: "package-lock.json", line: 2 });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    const code = container.textContent ?? "";
    // Core file is open by default too, so the shared patch body now appears
    // twice: once from `core`, once from the newly-expanded lockfile.
    expect(code.split("const b = 2;").length - 1).toBe(2);
  });

  it("ignores a target file that isn't in this PR's smart-diff groups (AC-26 graceful degradation)", () => {
    expect(() => renderViewer(undefined, { path: "no/such/file.ts", line: 1 })).not.toThrow();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });
});
