import { describe, it, expect } from "vitest";
import type { BlastSymbol } from "@devdigest/shared";
import { wrapLabel, layoutGraph, callerHref } from "./helpers";

function sym(over: Partial<BlastSymbol> = {}): BlastSymbol {
  return {
    name: "rateLimit",
    kind: "function",
    file: "src/limit.ts",
    change: "added",
    callers: [],
    caller_count: 0,
    endpoints: [],
    crons: [],
    ...over,
  };
}

const ep = (method: string, path: string) => ({ method, path, file: "src/routes.ts" });

describe("wrapLabel", () => {
  it("leaves a short label alone", () => {
    expect(wrapLabel("GET /health")).toEqual(["GET /health"]);
  });

  it("breaks a long route at a path segment, keeping the slash on the first line", () => {
    const lines = wrapLabel("POST /articles/${id}/publish", 16);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.endsWith("/")).toBe(true);
    expect(lines.join("")).toBe("POST /articles/${id}/publish");
  });

  it("never exceeds three lines, and ellipsises what will not fit", () => {
    const lines = wrapLabel("a".repeat(400), 20);
    expect(lines).toHaveLength(3);
    expect(lines[2]?.endsWith("…")).toBe(true);
  });

  it("hard-chunks a long unbroken run that has no slash to break on", () => {
    const lines = wrapLabel("x".repeat(50), 20);
    expect(lines[0]).toHaveLength(20);
  });
});

describe("layoutGraph", () => {
  it("gives every endpoint its own row", () => {
    // The original bug: all of a symbol's endpoints were placed at the symbol's
    // own row, so their labels drew on top of each other.
    const layout = layoutGraph([
      sym({
        endpoints: [ep("GET", "/articles"), ep("POST", "/articles"), ep("DELETE", "/articles/:id")],
      }),
    ]);
    const ys = layout.nodes.filter((n) => n.column === 2).map((n) => n.y);
    expect(ys).toHaveLength(3);
    expect(new Set(ys).size).toBe(3);
  });

  it("keeps callers and endpoints from colliding with each other", () => {
    const layout = layoutGraph([
      sym({
        callers: [
          { file: "src/a.ts", line: 1, symbol: "a", rank: 1 },
          { file: "src/b.ts", line: 2, symbol: "b", rank: 1 },
        ],
        endpoints: [ep("GET", "/x"), ep("GET", "/y")],
      }),
    ]);
    for (const col of [1, 2] as const) {
      const ys = layout.nodes.filter((n) => n.column === col).map((n) => n.y);
      expect(new Set(ys).size).toBe(ys.length);
    }
  });

  it("does not let one symbol's band overlap the next", () => {
    const layout = layoutGraph([
      sym({ name: "first", endpoints: [ep("GET", "/a"), ep("GET", "/b")] }),
      sym({ name: "second", file: "src/other.ts", endpoints: [ep("GET", "/c")] }),
    ]);
    const first = layout.nodes.find((n) => n.id.includes("first"))!;
    const second = layout.nodes.find((n) => n.id.includes("second"))!;
    expect(second.y).toBeGreaterThan(first.y);
    const allY = layout.nodes.filter((n) => n.column === 2).map((n) => n.y);
    expect(new Set(allY).size).toBe(3);
  });

  it("places a shared endpoint once and links both symbols to it", () => {
    const shared = ep("GET", "/articles");
    const layout = layoutGraph([
      sym({ name: "one", endpoints: [shared] }),
      sym({ name: "two", file: "src/two.ts", endpoints: [shared] }),
    ]);
    expect(layout.nodes.filter((n) => n.column === 2)).toHaveLength(1);
    expect(layout.edges.filter((e) => e.to === "e:GET /articles")).toHaveLength(2);
  });

  it("skips symbols with nothing downstream", () => {
    expect(layoutGraph([sym()]).nodes).toEqual([]);
  });

  it("sizes the canvas to the widest wrapped label", () => {
    const layout = layoutGraph([sym({ endpoints: [ep("GET", "/x")] })]);
    expect(layout.width).toBeGreaterThan(400);
    // and still inside a ~640px card, so the graph never needs a sideways scroll
    expect(layout.width).toBeLessThan(600);
    expect(layout.height).toBeGreaterThan(0);
  });
});

describe("callerHref", () => {
  it("prefers the indexed sha over the default branch", () => {
    expect(callerHref("o/r", "sha123", "main", "src/a.ts", 7)).toBe(
      "https://github.com/o/r/blob/sha123/src/a.ts#L7",
    );
  });

  it("returns undefined when neither a repo nor a ref is known", () => {
    expect(callerHref(null, null, null, "src/a.ts", 7)).toBeUndefined();
  });
});
