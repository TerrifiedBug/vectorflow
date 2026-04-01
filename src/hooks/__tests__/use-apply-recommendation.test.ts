// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockPush = vi.fn();
const mockMutate = vi.fn();
const mockInvalidateQueries = vi.fn();
const mockToastInfo = vi.fn();
const mockToastError = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: Record<string, unknown>) => ({
    mutate: (...args: unknown[]) => {
      mockMutate(...args);
      // Simulate onSuccess to trigger invalidation
      const opts = options as { onSuccess?: () => void };
      opts.onSuccess?.();
    },
    isPending: false,
  }),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    costRecommendation: {
      markApplied: {
        mutationOptions: (opts: Record<string, unknown>) => opts,
      },
      list: {
        queryKey: (input: Record<string, unknown>) => ["costRecommendation", "list", input],
      },
      summary: {
        queryKey: (input: Record<string, unknown>) => ["costRecommendation", "summary", input],
      },
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import { useApplyRecommendation } from "@/hooks/use-apply-recommendation";

describe("useApplyRecommendation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates to pipeline editor with recommendation query param", () => {
    const { result } = renderHook(() =>
      useApplyRecommendation("env-1"),
    );

    act(() => {
      result.current.applyRecommendation("rec-1", "pipeline-1");
    });

    expect(mockPush).toHaveBeenCalledWith(
      "/pipelines/pipeline-1/edit?recommendation=rec-1",
    );
  });

  it("fires markApplied mutation with correct params", () => {
    const { result } = renderHook(() =>
      useApplyRecommendation("env-1"),
    );

    act(() => {
      result.current.applyRecommendation("rec-1", "pipeline-1");
    });

    expect(mockMutate).toHaveBeenCalledWith({
      environmentId: "env-1",
      id: "rec-1",
    });
  });

  it("shows info toast when applying recommendation", () => {
    const { result } = renderHook(() =>
      useApplyRecommendation("env-1"),
    );

    act(() => {
      result.current.applyRecommendation("rec-1", "pipeline-1");
    });

    expect(mockToastInfo).toHaveBeenCalledWith(
      "Opening pipeline editor with suggested changes...",
    );
  });
});
