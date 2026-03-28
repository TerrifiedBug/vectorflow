"use client";
import { useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export interface FleetListFilters {
  search: string;
  statusFilter: string[];
  labelFilter: Record<string, string>;
  page: number; // 0-indexed internally
}

/** URL-synced filter and pagination state hook for the fleet node list. */
export function useFleetListFilters(): {
  search: string;
  statusFilter: string[];
  labelFilter: Record<string, string>;
  page: number;
  hasActiveFilters: boolean;
  setSearch: (value: string) => void;
  setStatusFilter: (statuses: string[]) => void;
  setLabelFilter: (labels: Record<string, string>) => void;
  setPage: (page: number) => void;
  clearFilters: () => void;
} {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read filter state from URL params (distinct names to avoid collision with matrix filter params)
  const search = searchParams.get("q") ?? "";

  const statusFilter =
    searchParams.get("nodeStatus")?.split(",").filter(Boolean) ?? [];

  const labelFilter: Record<string, string> = (() => {
    const raw = searchParams.get("nodeLabels");
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  })();

  // Page is 1-indexed in URL, 0-indexed internally; clamp to >= 0
  const page = Math.max(
    0,
    (parseInt(searchParams.get("nodePage") ?? "1", 10) || 1) - 1,
  );

  // Filter changes reset page to 0 (delete nodePage param) in the same replace() call
  const setSearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      params.delete("nodePage");
      router.replace(`/fleet?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const setStatusFilter = useCallback(
    (statuses: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (statuses.length > 0) {
        params.set("nodeStatus", statuses.join(","));
      } else {
        params.delete("nodeStatus");
      }
      params.delete("nodePage");
      router.replace(`/fleet?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const setLabelFilter = useCallback(
    (labels: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString());
      if (Object.keys(labels).length > 0) {
        params.set("nodeLabels", JSON.stringify(labels));
      } else {
        params.delete("nodeLabels");
      }
      params.delete("nodePage");
      router.replace(`/fleet?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const setPage = useCallback(
    (nextPage: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextPage === 0) {
        params.delete("nodePage");
      } else {
        params.set("nodePage", String(nextPage + 1));
      }
      router.replace(`/fleet?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const clearFilters = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("nodeStatus");
    params.delete("nodeLabels");
    params.delete("nodePage");
    router.replace(`/fleet?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const hasActiveFilters =
    search.length > 0 ||
    statusFilter.length > 0 ||
    Object.keys(labelFilter).length > 0;

  return {
    search,
    statusFilter,
    labelFilter,
    page,
    hasActiveFilters,
    setSearch,
    setStatusFilter,
    setLabelFilter,
    setPage,
    clearFilters,
  };
}
