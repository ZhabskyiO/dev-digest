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
    // though only the active one is browsable (AC-25).
    const draft = [ref("r1", "a.md"), ref("r2", "a.md"), ref("r1", "b.md")];
    const next = reorderDraft(draft, "r1", ["b.md", "a.md"]);
    expect(next).toEqual([ref("r1", "b.md"), ref("r1", "a.md"), ref("r2", "a.md")]);
  });

  it("keeps refs hidden by the filter", () => {
    const draft = [ref("r1", "a.md"), ref("r1", "hidden.md")];
    expect(reorderDraft(draft, "r1", ["a.md"]).map((r) => r.path)).toEqual(["a.md", "hidden.md"]);
  });

  it("is a no-op in content when the drag changed nothing", () => {
    const draft = [ref("r1", "a.md"), ref("r1", "b.md")];
    expect(refsEqual(reorderDraft(draft, "r1", ["a.md", "b.md"]), draft)).toBe(true);
  });
});
