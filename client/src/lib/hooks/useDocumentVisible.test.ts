import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDocumentVisible } from "./useDocumentVisible";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  // Restore the jsdom default so later tests in the file aren't affected.
  act(() => setHidden(false));
});

describe("useDocumentVisible", () => {
  it("starts true when the document is visible", () => {
    setHidden(false);
    const { result } = renderHook(() => useDocumentVisible());
    expect(result.current).toBe(true);
  });

  it("flips to false on visibilitychange when the document becomes hidden, and back to true when it is shown again", () => {
    const { result } = renderHook(() => useDocumentVisible());
    expect(result.current).toBe(true);

    act(() => setHidden(true));
    expect(result.current).toBe(false);

    act(() => setHidden(false));
    expect(result.current).toBe(true);
  });
});
