import { describe, it, expect } from "vitest";
import type { ProjectContextRef } from "@devdigest/shared";
import { refsEqual, reorderDraft } from "./helpers";

const ref = (repo: string, path: string): ProjectContextRef => ({ repo_id: repo, path });

describe("reorderDraft", () => {
  it("puts the active repo's refs in the order the drag produced", () => {
    const draft = [ref("r1", "a.md"), ref("r1", "b.md"), ref("r1", "c.md")];
    expect(reorderDraft(draft, "r1", ["c.md", "a.md", "b.md"]).map((r) => r.path)).toEqual([
      "c.md",
      "a.md",
      "b.md",
    ]);
  });

  it("never moves or drops an attachment from another repository", () => {
    // A skill is workspace-scoped and may carry refs from several repos even
    // though only the active one is browsable (AC-25). `r2/a.md` sits at
    // index 1, not the end, so it must stay there — not follow the reordered
    // block to the tail.
    const draft = [ref("r1", "a.md"), ref("r2", "a.md"), ref("r1", "b.md")];
    const next = reorderDraft(draft, "r1", ["b.md", "a.md"]);
    expect(next).toEqual([ref("r1", "b.md"), ref("r2", "a.md"), ref("r1", "a.md")]);
  });

  it("keeps a ref hidden by the filter at its original index, not the end", () => {
    // Concrete case from the spec: draft `[hidden.md, a.md, b.md]`, filter
    // hides `hidden.md`, drag `b` above `a` → `hidden.md` must stay first,
    // not jump to last.
    const draft = [ref("r1", "hidden.md"), ref("r1", "a.md"), ref("r1", "b.md")];
    const next = reorderDraft(draft, "r1", ["b.md", "a.md"]);
    expect(next.map((r) => r.path)).toEqual(["hidden.md", "b.md", "a.md"]);
  });

  it("is a no-op in content when the drag changed nothing", () => {
    const draft = [ref("r1", "a.md"), ref("r1", "b.md")];
    expect(refsEqual(reorderDraft(draft, "r1", ["a.md", "b.md"]), draft)).toBe(true);
  });

  it("behaves exactly as a full reorder when no filter is active", () => {
    // Every ref belongs to the active repo and is named in `paths` — all are
    // "moved", so the splice-back degenerates to a plain reorder.
    const draft = [ref("r1", "a.md"), ref("r1", "b.md"), ref("r1", "c.md")];
    expect(reorderDraft(draft, "r1", ["c.md", "b.md", "a.md"]).map((r) => r.path)).toEqual([
      "c.md",
      "b.md",
      "a.md",
    ]);
  });

  it("keeps multiple hidden/other-repo refs interleaved among visible ones at their own slots", () => {
    const draft = [
      ref("r2", "x.md"),
      ref("r1", "a.md"),
      ref("r1", "hidden.md"),
      ref("r1", "b.md"),
      ref("r2", "y.md"),
    ];
    const next = reorderDraft(draft, "r1", ["b.md", "a.md"]);
    expect(next.map((r) => r.path)).toEqual(["x.md", "b.md", "hidden.md", "a.md", "y.md"]);
  });
});
