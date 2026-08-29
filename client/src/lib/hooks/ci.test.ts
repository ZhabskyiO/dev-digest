import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CiInstallationStatus, CiRunList } from "@devdigest/shared";
import {
  useCiInstallations,
  useCiRuns,
  useCiPreview,
  useCiExport,
  useCiArchive,
  useConfirmCiInstallation,
  useRefreshCiRuns,
} from "./ci";
import { useDocumentVisible } from "./useDocumentVisible";
import { api } from "../api";

vi.mock("../api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.clearAllMocks();
  setHidden(false);
});

describe("useCiInstallations", () => {
  it("GETs /agents/:id/ci-installations under the [\"ci-installations\", agentId] key", async () => {
    const installations: CiInstallationStatus[] = [];
    vi.mocked(api.get).mockResolvedValueOnce(installations);
    const qc = newClient();

    const { result } = renderHook(() => useCiInstallations("agent-1"), {
      wrapper: makeWrapper(qc),
    });

    await waitFor(() => expect(result.current.data).toEqual(installations));
    expect(api.get).toHaveBeenCalledWith("/agents/agent-1/ci-installations");
    expect(qc.getQueryData(["ci-installations", "agent-1"])).toEqual(installations);
  });

  it("does not fetch when agentId is nullish", () => {
    const qc = newClient();
    renderHook(() => useCiInstallations(undefined), { wrapper: makeWrapper(qc) });
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe("useCiRuns", () => {
  it("GETs /ci-runs with the query serialized as a querystring, keyed on the query object", async () => {
    const list: CiRunList = { items: [], total: 0, refresh_error: null };
    vi.mocked(api.get).mockResolvedValueOnce(list);
    const qc = newClient();

    const query = { window: "7d" as const, agent_id: "agent-1", limit: 20, offset: 0 };
    const { result } = renderHook(() => useCiRuns(query), { wrapper: makeWrapper(qc) });

    await waitFor(() => expect(result.current.data).toEqual(list));
    const calledPath = vi.mocked(api.get).mock.calls[0]?.[0];
    expect(calledPath).toContain("/ci-runs?");
    expect(calledPath).toContain("window=7d");
    expect(calledPath).toContain("agent_id=agent-1");
    expect(calledPath).toContain("limit=20");
    expect(calledPath).toContain("offset=0");
  });

  it("omits the querystring entirely when the query has no set fields", async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ items: [], total: 0, refresh_error: null });
    const qc = newClient();
    renderHook(() => useCiRuns({}), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/ci-runs"));
  });
});

describe("CI mutations", () => {
  it("useCiPreview POSTs /agents/:id/ci-preview with the export body (agentId stripped out)", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ repo: "o/r", files: [] });
    const qc = newClient();
    const { result } = renderHook(() => useCiPreview(), { wrapper: makeWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ agentId: "agent-1", repo: "o/r" });
    });

    expect(api.post).toHaveBeenCalledWith("/agents/agent-1/ci-preview", { repo: "o/r" });
  });

  it("useCiExport POSTs /agents/:id/export-ci and invalidates the ci-installations prefix", async () => {
    const exportResult = {
      installation: {
        id: "i1",
        agent_id: "agent-1",
        repo: "o/r",
        target_type: "gha",
        installed_at: "2026-01-01",
        agent_version: 1,
        base_branch: "main",
        post_as: "github_review",
        triggers: ["opened"],
      },
      files: [],
      pr_url: null,
    };
    vi.mocked(api.post).mockResolvedValueOnce(exportResult);
    const qc = newClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCiExport(), { wrapper: makeWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ agentId: "agent-1", repo: "o/r" });
    });

    expect(api.post).toHaveBeenCalledWith("/agents/agent-1/export-ci", { repo: "o/r" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["ci-installations"] });
  });

  it("useCiArchive POSTs /agents/:id/ci-archive and does not invalidate anything", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ filename: "ci.zip", content_base64: "AA==" });
    const qc = newClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useCiArchive(), { wrapper: makeWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ agentId: "agent-1", repo: "o/r" });
    });

    expect(api.post).toHaveBeenCalledWith("/agents/agent-1/ci-archive", { repo: "o/r" });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("useConfirmCiInstallation POSTs /agents/:id/ci-installations and invalidates the ci-installations prefix", async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      id: "i1",
      agent_id: "agent-1",
      repo: "o/r",
      target_type: "gha",
      installed_at: "2026-01-01",
      agent_version: 1,
      base_branch: "main",
      post_as: "github_review",
      triggers: ["opened"],
    });
    const qc = newClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useConfirmCiInstallation(), { wrapper: makeWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({
        agentId: "agent-1",
        repo: "o/r",
        target: "gha",
        base: "main",
        post_as: "github_review",
        triggers: ["opened"],
      });
    });

    expect(api.post).toHaveBeenCalledWith("/agents/agent-1/ci-installations", {
      repo: "o/r",
      target: "gha",
      base: "main",
      post_as: "github_review",
      triggers: ["opened"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["ci-installations"] });
  });

  it("useRefreshCiRuns POSTs /ci-runs/refresh and invalidates the ci-runs prefix", async () => {
    const refreshed: CiRunList = { items: [], total: 0, refresh_error: null };
    vi.mocked(api.post).mockResolvedValueOnce(refreshed);
    const qc = newClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRefreshCiRuns(), { wrapper: makeWrapper(qc) });

    await act(async () => {
      await result.current.mutateAsync({ agent_id: "agent-1" });
    });

    expect(api.post).toHaveBeenCalledWith("/ci-runs/refresh", { agent_id: "agent-1" });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["ci-runs"] });
  });
});

describe("R12 — auto-refresh every 30s, suspended while the document is hidden", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops polling the instant the document goes hidden, and resumes once it is visible again", async () => {
    vi.useFakeTimers();
    const qc = newClient();
    vi.mocked(api.get).mockResolvedValue([]);

    const { unmount } = renderHook(
      () => {
        const visible = useDocumentVisible();
        return useCiInstallations("agent-1", { poll: visible });
      },
      { wrapper: makeWrapper(qc) },
    );

    // Initial fetch on mount.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.get).toHaveBeenCalledTimes(1);

    // Visible: 60s of elapsed time should produce further 30s-interval polls.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    const callsWhileVisible = vi.mocked(api.get).mock.calls.length;
    expect(callsWhileVisible).toBeGreaterThan(1);

    // Document goes hidden.
    await act(async () => {
      setHidden(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAtHide = vi.mocked(api.get).mock.calls.length;

    // Advance 60s while hidden — no further fetch calls should be recorded.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(vi.mocked(api.get).mock.calls.length).toBe(callsAtHide);

    // Document becomes visible again — polling resumes.
    await act(async () => {
      setHidden(false);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(vi.mocked(api.get).mock.calls.length).toBeGreaterThan(callsAtHide);

    unmount();
  });
});
