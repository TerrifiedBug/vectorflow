// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useApplyRecommendation } from "@/hooks/use-apply-recommendation";

describe("useApplyRecommendation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initially has no selected recommendation", () => {
    const { result } = renderHook(() => useApplyRecommendation());

    expect(result.current.selectedRecommendationId).toBeNull();
  });

  it("openApplyModal sets the selectedRecommendationId", () => {
    const { result } = renderHook(() => useApplyRecommendation());

    act(() => {
      result.current.openApplyModal("rec-1");
    });

    expect(result.current.selectedRecommendationId).toBe("rec-1");
  });

  it("closeApplyModal clears the selectedRecommendationId", () => {
    const { result } = renderHook(() => useApplyRecommendation());

    act(() => {
      result.current.openApplyModal("rec-1");
    });
    expect(result.current.selectedRecommendationId).toBe("rec-1");

    act(() => {
      result.current.closeApplyModal();
    });
    expect(result.current.selectedRecommendationId).toBeNull();
  });

  it("openApplyModal replaces previous selection", () => {
    const { result } = renderHook(() => useApplyRecommendation());

    act(() => {
      result.current.openApplyModal("rec-1");
    });
    act(() => {
      result.current.openApplyModal("rec-2");
    });

    expect(result.current.selectedRecommendationId).toBe("rec-2");
  });
});
