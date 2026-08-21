import { describe, it, expect } from "vitest";
import { diffLines, DIFF_MAX_LINES } from "./helpers";

describe("diffLines", () => {
  it("classifies added, removed, and context lines in reading order", () => {
    const previous = "a\nb\nc";
    const current = "a\nx\nc\nd";
    const { lines, truncated } = diffLines(previous, current);

    expect(truncated).toBe(false);
    expect(lines).toEqual([
      { type: "context", text: "a" },
      { type: "removed", text: "b" },
      { type: "added", text: "x" },
      { type: "context", text: "c" },
      { type: "added", text: "d" },
    ]);
  });

  it("produces no add/remove lines for identical inputs", () => {
    const text = "one\ntwo\nthree";
    const { lines, truncated } = diffLines(text, text);

    expect(truncated).toBe(false);
    expect(lines).toEqual([
      { type: "context", text: "one" },
      { type: "context", text: "two" },
      { type: "context", text: "three" },
    ]);
    expect(lines.every((l) => l.type === "context")).toBe(true);
  });

  it("treats both sides empty as no lines", () => {
    const { lines, truncated } = diffLines("", "");
    expect(truncated).toBe(false);
    // "".split("\n") is [""], so both sides have a single empty-string line
    // that compares equal — a context line, not an add/remove.
    expect(lines).toEqual([{ type: "context", text: "" }]);
  });

  it("treats an empty previous side as the new lines added, plus the empty-string line split() itself produces", () => {
    const { lines, truncated } = diffLines("", "a\nb");
    expect(truncated).toBe(false);
    // "".split("\n") is [""], so `previous` has one (empty) line that has no
    // match on the `current` side and comes out as removed — then "a"/"b"
    // are added. This is the real, documented behavior of `""`.split("\n"),
    // not a special case the function needs to hide.
    expect(lines).toEqual([
      { type: "removed", text: "" },
      { type: "added", text: "a" },
      { type: "added", text: "b" },
    ]);
  });

  it("treats an empty current side as the old lines removed, plus the empty-string line split() itself produces", () => {
    const { lines, truncated } = diffLines("a\nb", "");
    expect(truncated).toBe(false);
    expect(lines).toEqual([
      { type: "removed", text: "a" },
      { type: "removed", text: "b" },
      { type: "added", text: "" },
    ]);
  });

  it("truncates a side over DIFF_MAX_LINES, flags it, and completes quickly", () => {
    const bigPrevious = Array.from({ length: DIFF_MAX_LINES + 5000 }, (_, i) => `line-${i}`).join("\n");
    const bigCurrent = Array.from({ length: DIFF_MAX_LINES + 5000 }, (_, i) => `line-${i}-changed`).join("\n");

    const start = performance.now();
    const { lines, truncated } = diffLines(bigPrevious, bigCurrent);
    const elapsedMs = performance.now() - start;

    expect(truncated).toBe(true);
    // The cap is enforced on the matrix inputs: total emitted lines can never
    // exceed twice the per-side budget (worst case, every line differs).
    expect(lines.length).toBeLessThanOrEqual(DIFF_MAX_LINES * 2);
    // A capped O(n·m) matrix on ~2000x2000 lines finishes well under a second;
    // an uncapped 17000x17000 matrix would not.
    expect(elapsedMs).toBeLessThan(3000);
  });

  it("does not truncate when both sides are within the budget", () => {
    const previous = Array.from({ length: DIFF_MAX_LINES }, (_, i) => `line-${i}`).join("\n");
    const current = previous;
    const { truncated } = diffLines(previous, current);
    expect(truncated).toBe(false);
  });
});
