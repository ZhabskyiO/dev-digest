import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Skill, SkillVersion } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";
import { collapseUnchanged, diffLines, isIdentical } from "./helpers";

const SKILL: Skill = {
  id: "sk1",
  name: "pr-quality-rubric",
  description: "Rubric.",
  type: "rubric",
  source: "manual",
  body: "# Title\nline two\nline three",
  enabled: true,
  version: 3,
};

let VERSIONS: SkillVersion[] = [];
let loading = false;
let errored = false;
const restoreMutate = vi.fn();

vi.mock("../../../../../../lib/hooks/skills", () => ({
  useSkillVersions: () => ({
    data: VERSIONS,
    isLoading: loading,
    isError: errored,
    refetch: vi.fn(),
  }),
  useRestoreSkillVersion: () => ({ mutate: restoreMutate, isPending: false }),
}));

vi.mock("../../../../../../lib/toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import { VersionsTab } from "./VersionsTab";

afterEach(() => {
  cleanup();
  VERSIONS = [];
  loading = false;
  errored = false;
  vi.clearAllMocks();
});

function version(over: Partial<SkillVersion> = {}): SkillVersion {
  return {
    skill_id: "sk1",
    version: 1,
    body: "# Title\nold two\nline three",
    label: null,
    created_at: "2026-03-02T00:00:00Z",
    ...over,
  };
}

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <VersionsTab skill={SKILL} />
    </NextIntlClientProvider>,
  );
}

describe("diffLines", () => {
  it("marks a changed line as one removal and one addition", () => {
    const rows = diffLines("a\nb\nc", "a\nB\nc");
    expect(rows.map((r) => r.kind)).toEqual(["same", "del", "add", "same"]);
    expect(rows[1]).toMatchObject({ text: "b", oldNo: 2, newNo: null });
    expect(rows[2]).toMatchObject({ text: "B", oldNo: null, newNo: 2 });
  });

  it("reports pure additions", () => {
    const rows = diffLines("a", "a\nb");
    expect(rows.map((r) => r.kind)).toEqual(["same", "add"]);
  });

  it("reports pure removals", () => {
    const rows = diffLines("a\nb", "a");
    expect(rows.map((r) => r.kind)).toEqual(["same", "del"]);
  });

  it("keeps a moved block recognisable rather than rewriting everything", () => {
    const rows = diffLines("a\nb\nc\nd", "a\nc\nd");
    expect(rows.filter((r) => r.kind === "del").map((r) => r.text)).toEqual(["b"]);
    expect(rows.filter((r) => r.kind === "add")).toHaveLength(0);
  });

  it("isIdentical is true only when nothing changed", () => {
    expect(isIdentical(diffLines("a\nb", "a\nb"))).toBe(true);
    expect(isIdentical(diffLines("a\nb", "a\nc"))).toBe(false);
  });

  it("collapseUnchanged keeps context around a change and drops the rest", () => {
    const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 20", "line twenty");
    const rows = collapseUnchanged(diffLines(before, after), 2);
    // 2 context + del + add + 2 context, not all 41 rows.
    expect(rows.length).toBeLessThan(10);
    expect(rows.some((r) => r.text === "line twenty")).toBe(true);
  });

  it("collapseUnchanged returns nothing when there is no change to anchor on", () => {
    expect(collapseUnchanged(diffLines("a\nb\nc", "a\nb\nc"))).toEqual([]);
  });
});

describe("VersionsTab", () => {
  it("lists versions with their labels and marks the newest current", () => {
    VERSIONS = [
      version({ version: 3, label: "Tightened scope rule", created_at: "2026-05-30T00:00:00Z" }),
      version({ version: 2, label: "Added Tests dimension" }),
      version({ version: 1 }),
    ];
    renderTab();

    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("Tightened scope rule")).toBeInTheDocument();
    expect(screen.getByText(messages.versions.current)).toBeInTheDocument();
    expect(screen.getByText("3 versions")).toBeInTheDocument();
    // A snapshot with no note says so rather than rendering blank.
    expect(screen.getByText(messages.versions.unlabelled)).toBeInTheDocument();
  });

  it("offers no Diff or Restore on the current version", () => {
    VERSIONS = [version({ version: 3 })];
    renderTab();
    expect(screen.queryByText(messages.versions.diff)).toBeNull();
    expect(screen.queryByText(messages.versions.restore)).toBeNull();
  });

  it("shows an inline diff of an older version against the current body", () => {
    VERSIONS = [version({ version: 3 }), version({ version: 1 })];
    renderTab();

    fireEvent.click(screen.getByText(messages.versions.diff));
    // "old two" was removed, "line two" added.
    expect(screen.getByText("old two")).toBeInTheDocument();
    expect(screen.getByText("line two")).toBeInTheDocument();
    // Toggles closed again.
    fireEvent.click(screen.getByText(messages.versions.hideDiff));
    expect(screen.queryByText("old two")).toBeNull();
  });

  it("says so when an older snapshot matches the current body", () => {
    VERSIONS = [version({ version: 3 }), version({ version: 1, body: SKILL.body })];
    renderTab();
    fireEvent.click(screen.getByText(messages.versions.diff));
    expect(screen.getByText(messages.versions.diffIdentical)).toBeInTheDocument();
  });

  it("restores through the mutation with the chosen version", () => {
    VERSIONS = [version({ version: 3 }), version({ version: 1 })];
    renderTab();
    fireEvent.click(screen.getByText(messages.versions.restore));
    expect(restoreMutate).toHaveBeenCalledWith(
      { skillId: "sk1", version: 1 },
      expect.anything(),
    );
  });

  it("explains the empty case instead of rendering a bare list", () => {
    renderTab();
    expect(screen.getByText(messages.versions.empty)).toBeInTheDocument();
  });

  it("surfaces a load error with a retry", () => {
    errored = true;
    renderTab();
    expect(screen.getByText(messages.versions.loadError)).toBeInTheDocument();
  });
});
