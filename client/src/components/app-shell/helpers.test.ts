import { describe, expect, it } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor", () => {
  it("does not highlight the onboarding tour for the add-repository screen", () => {
    expect(activeKeyFor("/onboarding")).toBe("");
  });

  it("highlights the onboarding tour for a repo-scoped onboarding route", () => {
    expect(activeKeyFor("/repos/abc/onboarding")).toBe("onboarding-tour");
  });

  it("leaves every other existing mapping unchanged", () => {
    expect(activeKeyFor("/settings/api-keys")).toBe("settings");
    expect(activeKeyFor("/repos/abc/context")).toBe("context");
    expect(activeKeyFor("/repos/abc/conventions")).toBe("conventions");
    expect(activeKeyFor("/repos/abc/pulls")).toBe("pulls");
    expect(activeKeyFor("/skills")).toBe("skills");
    expect(activeKeyFor("/agents")).toBe("agents");
    expect(activeKeyFor("/eval")).toBe("eval");
    expect(activeKeyFor("/memory")).toBe("memory");
    expect(activeKeyFor("/repos/abc/pulls/1/multi-agent")).toBe("multi-agent");
  });
});
