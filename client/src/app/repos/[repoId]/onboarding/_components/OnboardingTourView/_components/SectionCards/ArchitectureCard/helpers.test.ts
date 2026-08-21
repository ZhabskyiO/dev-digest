import { describe, it, expect } from "vitest";
import { stripMarkdownLinks } from "./helpers";

describe("stripMarkdownLinks", () => {
  it("drops the href from an inline link but keeps its visible text (M6)", () => {
    expect(stripMarkdownLinks("See [click me](https://attacker.example) for docs.")).toBe(
      "See click me for docs.",
    );
  });

  it("drops a reference-style link and its definition line", () => {
    const input = "Read [the guide][ref] for more.\n\n[ref]: https://attacker.example \"title\"";
    expect(stripMarkdownLinks(input)).toBe("Read the guide for more.\n\n");
  });

  it("neutralizes an explicit autolink into inert code text", () => {
    expect(stripMarkdownLinks("Visit <https://attacker.example> now.")).toBe(
      "Visit `https://attacker.example` now.",
    );
  });

  it("neutralizes a bare GFM autolink literal into inert code text", () => {
    expect(stripMarkdownLinks("Visit https://attacker.example now.")).toBe(
      "Visit `https://attacker.example` now.",
    );
  });

  it("leaves plain prose with no link syntax untouched", () => {
    expect(stripMarkdownLinks("**payments-api** is a Node service.")).toBe(
      "**payments-api** is a Node service.",
    );
  });
});
