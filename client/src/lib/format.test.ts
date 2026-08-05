/**
 * The product rule under test: a run with no known price shows `—`, NEVER
 * `$0.00`. A misleading zero reads as "this was free", which is the one wrong
 * answer the cost badge must never give.
 */
import { describe, it, expect } from "vitest";
import { formatCostUsd, formatDurationMs, formatTokensCompact, NO_VALUE } from "./format";

describe("formatCostUsd", () => {
  it("renders missing data as an em dash, never $0.00", () => {
    expect(formatCostUsd(null)).toBe(NO_VALUE);
    expect(formatCostUsd(undefined)).toBe(NO_VALUE);
    expect(formatCostUsd(Number.NaN)).toBe(NO_VALUE);
  });

  it("distinguishes a genuinely free run from an unpriced one", () => {
    expect(formatCostUsd(0)).toBe("$0.0000");
    expect(formatCostUsd(null)).toBe(NO_VALUE);
  });

  it("keeps 4 decimals below a cent, where most single runs land", () => {
    expect(formatCostUsd(0.0013)).toBe("$0.0013");
    expect(formatCostUsd(0.00128)).toBe("$0.0013");
  });

  it("uses 3 decimals below a dollar", () => {
    expect(formatCostUsd(0.0141)).toBe("$0.014");
    expect(formatCostUsd(0.06)).toBe("$0.060");
  });

  it("uses 2 decimals at a dollar and above", () => {
    expect(formatCostUsd(1.2345)).toBe("$1.23");
    expect(formatCostUsd(12.5)).toBe("$12.50");
  });

  it("switches precision exactly at the boundaries", () => {
    expect(formatCostUsd(0.00999)).toBe("$0.0100"); // still the <$0.01 branch
    expect(formatCostUsd(0.01)).toBe("$0.010");
    expect(formatCostUsd(0.999)).toBe("$0.999");
    expect(formatCostUsd(1)).toBe("$1.00");
  });
});

describe("formatTokensCompact", () => {
  it("groups thousands", () => {
    expect(formatTokensCompact(9119)).toBe("9,119");
    expect(formatTokensCompact(12011)).toBe("12,011");
    expect(formatTokensCompact(0)).toBe("0");
  });

  it("renders missing data as an em dash", () => {
    expect(formatTokensCompact(null)).toBe(NO_VALUE);
    expect(formatTokensCompact(undefined)).toBe(NO_VALUE);
  });
});

describe("formatDurationMs", () => {
  it("renders as seconds with one decimal place", () => {
    expect(formatDurationMs(6234)).toBe("6.2s");
    expect(formatDurationMs(500)).toBe("0.5s");
    expect(formatDurationMs(0)).toBe("0.0s");
  });

  it("renders missing data as an em dash", () => {
    expect(formatDurationMs(null)).toBe(NO_VALUE);
    expect(formatDurationMs(undefined)).toBe(NO_VALUE);
  });
});
