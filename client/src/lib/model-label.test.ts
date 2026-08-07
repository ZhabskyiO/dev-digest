import { describe, it, expect } from "vitest";
import { usableModels, toModelOptions, modelLabel } from "./model-label";

describe("usableModels", () => {
  it("drops only models that explicitly report no structured output", () => {
    const { usable, hidden } = usableModels([
      { id: "a", supportsStructuredOutput: true },
      { id: "b", supportsStructuredOutput: false },
      { id: "c", supportsStructuredOutput: null },
      { id: "d" },
    ]);
    expect(usable.map((m) => m.id)).toEqual(["a", "c", "d"]);
    expect(hidden).toBe(1);
  });

  it("keeps every model when the provider reports no capability at all", () => {
    // OpenAI and Anthropic never send the field — filtering on unknown would
    // empty their pickers entirely.
    const { usable, hidden } = usableModels([{ id: "gpt-4.1" }, { id: "gpt-4o-mini" }]);
    expect(usable).toHaveLength(2);
    expect(hidden).toBe(0);
  });

  it("handles an undefined list (still loading)", () => {
    expect(usableModels(undefined)).toEqual({ usable: [], hidden: 0 });
  });
});

describe("modelLabel", () => {
  it("appends price and context when both are known", () => {
    expect(
      modelLabel({
        id: "deepseek/deepseek-v4-flash",
        pricing: { promptPerM: 0.14, completionPerM: 0.28 },
        contextLength: 1_000_000,
      }),
    ).toBe("deepseek/deepseek-v4-flash — $0.140/$0.280 per 1M · 1M ctx");
  });

  it("falls back to the bare id when the provider exposes neither", () => {
    expect(modelLabel({ id: "gpt-4.1" })).toBe("gpt-4.1");
  });
});

describe("toModelOptions", () => {
  it("uses a plain string for unpriced models and an object for priced ones", () => {
    expect(
      toModelOptions([{ id: "gpt-4.1" }, { id: "x", pricing: { promptPerM: 1, completionPerM: 2 } }]),
    ).toEqual(["gpt-4.1", { value: "x", label: "x — $1.00/$2.00 per 1M" }]);
  });
});
