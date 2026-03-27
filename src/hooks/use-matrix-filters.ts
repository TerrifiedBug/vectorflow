"use client";
import { useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export interface MatrixFilters {
  search: string;
  statusFilter: string[];
  tagFilter: string[];
}

/** URL-synced filter state hook for the deployment matrix. */
export function useMatrixFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const search = searchParams.get("search") ?? "";
  const statusFilter =
    searchParams.get("status")?.split(",").filter(Boolean) ?? [];
  const tagFilter =
    searchParams.get("tags")?.split(",").filter(Boolean) ?? [];

  const setSearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set("search", value);
      } else {
        params.delete("search");
      }
      router.replace(`/fleet?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const setStatusFilter = useCallback(
    (statuses: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (statuses.length > 0) {
        params.set("status", statuses.join(","));
      } else {
        params.delete("status");
      }
      router.replace(`/fleet?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const setTagFilter = useCallback(
    (tags: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tags.length > 0) {
        params.set("tags", tags.join(","));
      } else {
        params.delete("tags");
      }
      router.replace(`/fleet?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const clearFilters = useCallback(() => {
    router.replace("/fleet", { scroll: false });
  }, [router]);

  const hasActiveFilters =
    search.length > 0 || statusFilter.length > 0 || tagFilter.length > 0;

  return {
    search,
    statusFilter,
    tagFilter,
    hasActiveFilters,
    setSearch,
    setStatusFilter,
    setTagFilter,
    clearFilters,
  };
}
