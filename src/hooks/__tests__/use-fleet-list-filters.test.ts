// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockReplace = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => currentSearchParams,
}));

import { useFleetListFilters } from "@/hooks/use-fleet-list-filters";

describe("useFleetListFilters", () => {
  beforeEach(() => {
    currentSearchParams = new URLSearchParams();
    mockReplace.mockClear();
  });

  it("returns default state when no URL params exist", () => {
    const { result } = renderHook(() => useFleetListFilters());
    expect(result.current.search).toBe("");
    expect(result.current.statusFilter).toEqual([]);
    expect(result.current.labelFilter).toEqual({});
    expect(result.current.page).toBe(0);
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it("reads filter state from URL params", () => {
    currentSearchParams = new URLSearchParams(
      'q=foo&nodeStatus=healthy,unhealthy&nodeLabels={"env":"prod"}&nodePage=3',
    );
    const { result } = renderHook(() => useFleetListFilters());
    expect(result.current.search).toBe("foo");
    expect(result.current.statusFilter).toEqual(["healthy", "unhealthy"]);
    expect(result.current.labelFilter).toEqual({ env: "prod" });
    expect(result.current.page).toBe(2); // 0-indexed: URL 3 → internal 2
    expect(result.current.hasActiveFilters).toBe(true);
  });

  it("setSearch updates q param and deletes nodePage", () => {
    currentSearchParams = new URLSearchParams("nodePage=2");
    const { result } = renderHook(() => useFleetListFilters());

    act(() => {
      result.current.setSearch("foo");
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("q")).toBe("foo");
    expect(params.has("nodePage")).toBe(false);
  });

  it("setStatusFilter updates nodeStatus param", () => {
    const { result } = renderHook(() => useFleetListFilters());

    act(() => {
      result.current.setStatusFilter(["healthy"]);
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("nodeStatus")).toBe("healthy");
  });

  it("setLabelFilter updates nodeLabels param as JSON", () => {
    const { result } = renderHook(() => useFleetListFilters());

    act(() => {
      result.current.setLabelFilter({ env: "prod" });
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(JSON.parse(params.get("nodeLabels")!)).toEqual({ env: "prod" });
  });

  it("setPage converts 0-indexed page to 1-indexed URL param", () => {
    const { result } = renderHook(() => useFleetListFilters());

    act(() => {
      result.current.setPage(2);
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("nodePage")).toBe("3"); // 0-indexed 2 → URL 3
  });

  it("clearFilters deletes q, nodeStatus, nodeLabels, and nodePage", () => {
    currentSearchParams = new URLSearchParams(
      'q=foo&nodeStatus=healthy&nodeLabels={"env":"prod"}&nodePage=2',
    );
    const { result } = renderHook(() => useFleetListFilters());

    act(() => {
      result.current.clearFilters();
    });

    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.has("q")).toBe(false);
    expect(params.has("nodeStatus")).toBe(false);
    expect(params.has("nodeLabels")).toBe(false);
    expect(params.has("nodePage")).toBe(false);
  });
});
