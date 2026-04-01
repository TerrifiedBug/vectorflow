// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockReplace = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => currentSearchParams,
  usePathname: () => "/test",
}));

import { useMatrixFilters } from "@/hooks/use-matrix-filters";

describe("useMatrixFilters", () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams();
    mockReplace.mockClear();
  });

  it("returns default state when no URL params exist", () => {
    const { result } = renderHook(() => useMatrixFilters());
    expect(result.current.search).toBe("");
    expect(result.current.statusFilter).toEqual([]);
    expect(result.current.tagFilter).toEqual([]);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it("reads filter state from URL params", () => {
    currentSearchParams = new URLSearchParams(
      "search=agent&status=deployed,failed&tags=prod,staging",
    );
    const { result } = renderHook(() => useMatrixFilters());
    expect(result.current.search).toBe("agent");
    expect(result.current.statusFilter).toEqual(["deployed", "failed"]);
    expect(result.current.tagFilter).toEqual(["prod", "staging"]);
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it("setSearch updates search param", () => {
    const { result } = renderHook(() => useMatrixFilters());

    act(() => {
      result.current.setSearch("foo");
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("search")).toBe("foo");
  });

  it("setStatusFilter updates status param", () => {
    const { result } = renderHook(() => useMatrixFilters());

    act(() => {
      result.current.setStatusFilter(["deployed"]);
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("status")).toBe("deployed");
  });

  it("setTagFilter updates tags param with comma-separated values", () => {
    const { result } = renderHook(() => useMatrixFilters());

    act(() => {
      result.current.setTagFilter(["prod", "staging"]);
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("tags")).toBe("prod,staging");
  });

  it("clearFilters replaces with just the pathname", () => {
    currentSearchParams = new URLSearchParams(
      "search=agent&status=deployed&tags=prod",
    );
    const { result } = renderHook(() => useMatrixFilters());

    act(() => {
      result.current.clearFilters();
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/test", { scroll: false });
  });
});
