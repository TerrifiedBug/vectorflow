// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockReplace = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => currentSearchParams,
}));

import { usePipelineListFilters } from "@/hooks/use-pipeline-list-filters";

describe("usePipelineListFilters", () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams();
    mockReplace.mockClear();
  });

  it("returns default state when no URL params exist", () => {
    const { result } = renderHook(() => usePipelineListFilters());
    expect(result.current.search).toBe("");
    expect(result.current.statusFilter).toEqual([]);
    expect(result.current.tagFilter).toEqual([]);
    expect(result.current.groupId).toBeNull();
    expect(result.current.sortBy).toBe("updatedAt");
    expect(result.current.sortOrder).toBe("desc");
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it("reads filter state from URL params", () => {
    currentSearchParams = new URLSearchParams(
      "search=test&status=running,stopped&tags=prod,staging&groupId=group-1&sortBy=name&sortOrder=asc",
    );
    const { result } = renderHook(() => usePipelineListFilters());
    expect(result.current.search).toBe("test");
    expect(result.current.statusFilter).toEqual(["running", "stopped"]);
    expect(result.current.tagFilter).toEqual(["prod", "staging"]);
    expect(result.current.groupId).toBe("group-1");
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortOrder).toBe("asc");
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it("setSearch updates search param", () => {
    const { result } = renderHook(() => usePipelineListFilters());

    act(() => {
      result.current.setSearch("foo");
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("search")).toBe("foo");
  });

  it("setStatusFilter updates status param", () => {
    const { result } = renderHook(() => usePipelineListFilters());

    act(() => {
      result.current.setStatusFilter(["running"]);
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("status")).toBe("running");
  });

  it("setTagFilter updates tags param", () => {
    const { result } = renderHook(() => usePipelineListFilters());

    act(() => {
      result.current.setTagFilter(["prod"]);
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("tags")).toBe("prod");
  });

  it("setGroupId updates groupId param", () => {
    const { result } = renderHook(() => usePipelineListFilters());

    act(() => {
      result.current.setGroupId("group-1");
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("groupId")).toBe("group-1");
  });

  it("setSortBy updates sortBy param", () => {
    const { result } = renderHook(() => usePipelineListFilters());

    act(() => {
      result.current.setSortBy("name");
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("sortBy")).toBe("name");
  });

  it("clearFilters removes search, status, tags, groupId but preserves sort", () => {
    currentSearchParams = new URLSearchParams(
      "search=test&status=running&tags=prod&groupId=g1&sortBy=name&sortOrder=asc",
    );
    const { result } = renderHook(() => usePipelineListFilters());

    act(() => {
      result.current.clearFilters();
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.has("search")).toBe(false);
    expect(params.has("status")).toBe(false);
    expect(params.has("tags")).toBe(false);
    expect(params.has("groupId")).toBe(false);
    // Sort params should be preserved
    expect(params.get("sortBy")).toBe("name");
    expect(params.get("sortOrder")).toBe("asc");
  });
});
