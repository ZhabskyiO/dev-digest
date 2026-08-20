import { describe, it, expect } from "vitest";
import type { ProjectContextRef } from "@devdigest/shared";
import { filterByPath, reorderRefs } from "./helpers";

const ref = (repo: string, path: string): ProjectContextRef => ({ repo_id: repo, path });

describe("reorderRefs", () => {
  it("puts the refs in the order the drag produced", () => {
    const refs = [ref("r1", "a.md"), ref("r1", "b.md"), ref("r1", "c.md")];
    expect(reorderRefs(refs, ["c.md", "a.md", "b.md"]).map((r) => r.path)).toEqual([
      "c.md",
      "a.md",
      "b.md",
    ]);
  });

  it("keeps refs the list was not showing instead of dropping them", () => {
    // `hidden.md` is filtered out of the view, so it never reaches `paths` —
    // persisting the drag must not detach it, and — since it sits at index 1,
    // not the end — must not silently relocate it either: it must stay at its
    // ORIGINAL index while the visible refs are spliced back into their own
    // original slots (indices 0 and 2).
    const refs = [ref("r1", "a.md"), ref("r1", "hidden.md"), ref("r1", "b.md")];
    const next = reorderRefs(refs, ["b.md", "a.md"]);
    expect(next.map((r) => r.path)).toEqual(["b.md", "hidden.md", "a.md"]);
  });

  it("keeps attachments from another repository at their original index", () => {
    const refs = [ref("r1", "a.md"), ref("r2", "legacy.md"), ref("r1", "b.md")];
    const next = reorderRefs(refs, ["b.md", "a.md"]);
    expect(next.map((r) => r.path)).toEqual(["b.md", "legacy.md", "a.md"]);
  });

  it("ignores a path that is no longer attached", () => {
    const refs = [ref("r1", "a.md")];
    expect(reorderRefs(refs, ["a.md", "gone.md"])).toEqual([ref("r1", "a.md")]);
  });

  it("behaves exactly as a full reorder when no filter is active", () => {
    // All refs are shown (paths covers every ref) — every ref is "moved", so
    // the splice-back degenerates to a plain reorder, same as before the fix.
    const refs = [ref("r1", "a.md"), ref("r1", "b.md"), ref("r1", "c.md")];
    expect(reorderRefs(refs, ["c.md", "b.md", "a.md"]).map((r) => r.path)).toEqual([
      "c.md",
      "b.md",
      "a.md",
    ]);
  });

  it("keeps multiple hidden refs interleaved among visible ones at their own slots", () => {
    const refs = [
      ref("r1", "hidden1.md"),
      ref("r1", "a.md"),
      ref("r1", "hidden2.md"),
      ref("r1", "b.md"),
      ref("r1", "hidden3.md"),
    ];
    const next = reorderRefs(refs, ["b.md", "a.md"]);
    expect(next.map((r) => r.path)).toEqual(["hidden1.md", "b.md", "hidden2.md", "a.md", "hidden3.md"]);
  });
});

describe("filterByPath", () => {
  it("matches case-insensitively on any part of the path", () => {
    const items = [{ path: "specs/Public-API.md" }, { path: "docs/setup.md" }];
    expect(filterByPath(items, "public")).toEqual([{ path: "specs/Public-API.md" }]);
  });

  it("returns everything for an empty query", () => {
    const items = [{ path: "a.md" }, { path: "b.md" }];
    expect(filterByPath(items, "  ")).toHaveLength(2);
  });
});
