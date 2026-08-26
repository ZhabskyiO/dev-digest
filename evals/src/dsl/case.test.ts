import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readMatches } from "./case.js";
import { REPO_ROOT } from "../artifacts/paths.js";

describe("readMatches", () => {
  it("plain expectations are substrings", () => {
    expect(readMatches(join(REPO_ROOT, "server/CLAUDE.md"), "server/CLAUDE.md")).toBe(true);
    expect(readMatches(join(REPO_ROOT, "server/README.md"), "README.md")).toBe(true);
    expect(readMatches(join(REPO_ROOT, "docs/agent-prompts/security-reviewer.md"), "docs/agent-prompts/")).toBe(true);
    expect(readMatches(join(REPO_ROOT, "client/CLAUDE.md"), "server/CLAUDE.md")).toBe(false);
  });

  it("`./` anchors at the repo root", () => {
    expect(readMatches(join(REPO_ROOT, "README.md"), "./README.md")).toBe(true);
    expect(readMatches("README.md", "./README.md")).toBe(true);
    expect(readMatches(join(REPO_ROOT, "server/README.md"), "./README.md")).toBe(false);
    expect(readMatches(join(REPO_ROOT, "server/clones/x/README.md"), "./README.md")).toBe(false);
  });
});
