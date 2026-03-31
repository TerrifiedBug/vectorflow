"use client";
import { useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

export interface MatrixFilters {
  search: string;
  statusFilter: string[];
  tagFilter: string[];
}

/** URL-synced filter state hook for the deployment matrix. */
export function useMatrixFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

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
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const setStatusFilter = useCallback(
    (statuses: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (statuses.length > 0) {
        params.set("status", statuses.join(","));
      } else {
        params.delete("status");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const setTagFilter = useCallback(
    (tags: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (tags.length > 0) {
        params.set("tags", tags.join(","));
      } else {
        params.delete("tags");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  const clearFilters = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

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
