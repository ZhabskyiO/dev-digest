import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OnboardingTourResponse, OnboardingGenerateResponse } from "@devdigest/shared";
import { useOnboardingTour, useGenerateOnboardingTour } from "./onboarding";
import { api } from "../api";

vi.mock("../api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
}));

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: qc }, children);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useGenerateOnboardingTour", () => {
  it("relies on invalidateQueries alone — no dead optimistic setQueryData write, the query re-fetches the server's own state after generate succeeds (L5)", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const setQueryDataSpy = vi.spyOn(qc, "setQueryData");

    const empty: OnboardingTourResponse = {
      tour: null,
      state: "empty",
      stale: false,
      failure_reason: null,
      job_id: null,
    };
    const generating: OnboardingTourResponse = {
      tour: null,
      state: "generating",
      stale: false,
      failure_reason: null,
      job_id: "job1",
    };
    const generateResponse: OnboardingGenerateResponse = {
      state: "generating",
      job: { id: "job1" },
    };

    vi.mocked(api.get).mockResolvedValueOnce(empty).mockResolvedValueOnce(generating);
    vi.mocked(api.post).mockResolvedValueOnce(generateResponse);

    const { result } = renderHook(
      () => ({
        tour: useOnboardingTour("r1"),
        generate: useGenerateOnboardingTour("r1"),
      }),
      { wrapper: makeWrapper(qc) },
    );

    await waitFor(() => expect(result.current.tour.data?.state).toBe("empty"));

    await act(async () => {
      await result.current.generate.mutateAsync();
    });

    // The refetch triggered by `invalidateQueries` is what the UI ends up
    // reflecting — not a hand-written optimistic guess.
    await waitFor(() => expect(result.current.tour.data?.state).toBe("generating"));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(setQueryDataSpy).not.toHaveBeenCalled();
  });
});
