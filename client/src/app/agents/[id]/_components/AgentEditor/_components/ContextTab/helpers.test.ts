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
    // persisting the drag must not detach it.
    const refs = [ref("r1", "a.md"), ref("r1", "hidden.md"), ref("r1", "b.md")];
    const next = reorderRefs(refs, ["b.md", "a.md"]);
    expect(next.map((r) => r.path)).toEqual(["b.md", "a.md", "hidden.md"]);
  });

  it("keeps attachments from another repository", () => {
    const refs = [ref("r1", "a.md"), ref("r2", "legacy.md"), ref("r1", "b.md")];
    const next = reorderRefs(refs, ["b.md", "a.md"]);
    expect(next).toContainEqual(ref("r2", "legacy.md"));
    expect(next).toHaveLength(3);
  });

  it("ignores a path that is no longer attached", () => {
    const refs = [ref("r1", "a.md")];
    expect(reorderRefs(refs, ["a.md", "gone.md"])).toEqual([ref("r1", "a.md")]);
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
