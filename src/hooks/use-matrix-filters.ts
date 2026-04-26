"use client";
import { useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

export interface MatrixFilters {
  search: string;
  statusFilter: string[];
  tagFilter: string[];
}

// Default status filter applied when the URL has no `status` param at all.
// An explicit empty `?status=` overrides the default (means "show all").
const DEFAULT_STATUS_FILTER: readonly string[] = ["running"] as const;

/** URL-synced filter state hook for the deployment matrix. */
export function useMatrixFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const search = searchParams.get("search") ?? "";

  const statusParam = searchParams.get("status");
  const statusFilter =
    statusParam === null
      ? [...DEFAULT_STATUS_FILTER]
      : statusParam.split(",").filter(Boolean);

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
        // Explicit empty overrides the "running" default; otherwise the next
        // render would silently re-apply the default.
        params.set("status", "");
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
    // Status="" is the explicit override (otherwise the default re-applies).
    router.replace(`${pathname}?status=`, { scroll: false });
  }, [router, pathname]);

  // The "running" default is not considered an active filter — the chip/banner
  // shouldn't appear until the user has actually changed something.
  const isStatusAtDefault = statusParam === null;
  const hasActiveFilters =
    search.length > 0 ||
    (statusFilter.length > 0 && !isStatusAtDefault) ||
    tagFilter.length > 0;

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
