// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

let currentSearchParams = new URLSearchParams();
const mockToastInfo = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => currentSearchParams,
}));

let mockQueryData: Record<string, unknown> | undefined = undefined;
let mockQueryEnabled = true;

vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: { enabled?: boolean }) => {
    mockQueryEnabled = options.enabled ?? true;
    return {
      data: mockQueryEnabled ? mockQueryData : undefined,
      isLoading: false,
    };
  },
}));

vi.mock("@/trpc/client", () => ({
  useTRPC: () => ({
    costRecommendation: {
      getById: {
        queryOptions: (input: Record<string, unknown>, opts: Record<string, unknown>) => ({
          queryKey: ["costRecommendation", "getById", input],
          ...opts,
        }),
      },
    },
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
}));

import { useRecommendationContext } from "@/hooks/use-recommendation-context";

describe("useRecommendationContext", () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams();
    mockQueryData = undefined;
    mockToastInfo.mockClear();
  });

  it("returns null when no recommendation param exists", () => {
    const { result } = renderHook(() =>
      useRecommendationContext("env-1"),
    );
    expect(result.current).toBeNull();
  });

  it("returns recommendation data when param exists", () => {
    currentSearchParams = new URLSearchParams("recommendation=rec-1");
    mockQueryData = {
      id: "rec-1",
      title: "Reduce log volume",
      suggestedAction: null,
      aiSuggestions: null,
    };

    const { result } = renderHook(() =>
      useRecommendationContext("env-1"),
    );

    expect(result.current).not.toBeNull();
    expect(result.current!.recommendation).toEqual(mockQueryData);
    expect(result.current!.isLoading).toBe(false);
  });

  it("parses aiSuggestions array and shows count toast", () => {
    currentSearchParams = new URLSearchParams("recommendation=rec-1");
    const suggestions = [
      { type: "add_transform", config: {} },
      { type: "modify_sink", config: {} },
    ];
    mockQueryData = {
      id: "rec-1",
      suggestedAction: null,
      aiSuggestions: suggestions,
    };

    renderHook(() => useRecommendationContext("env-1"));

    expect(mockToastInfo).toHaveBeenCalledWith(
      "2 suggested changes ready to apply",
      { duration: 8000 },
    );
  });

  it("shows action label toast when suggestedAction is present", () => {
    currentSearchParams = new URLSearchParams("recommendation=rec-1");
    mockQueryData = {
      id: "rec-1",
      suggestedAction: { type: "add_sampling", config: {} },
      aiSuggestions: null,
    };

    renderHook(() => useRecommendationContext("env-1"));

    expect(mockToastInfo).toHaveBeenCalledWith(
      "Add a sampling transform to reduce data volume",
      { duration: 8000 },
    );
  });
});
