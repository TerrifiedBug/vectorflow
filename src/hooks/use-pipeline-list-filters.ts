"use client";
import { useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export interface PipelineListFilters {
  search: string;
  statusFilter: string[];
  tagFilter: string[];
  groupId: string | null;
  sortBy: "name" | "updatedAt" | "deployedAt";
  sortOrder: "asc" | "desc";
}

/** URL-synced filter state for the pipeline list page. */
export function usePipelineListFilters(): {
  search: string;
  statusFilter: string[];
  tagFilter: string[];
  groupId: string | null;
  sortBy: "name" | "updatedAt" | "deployedAt";
  sortOrder: "asc" | "desc";
  hasActiveFilters: boolean;
  setSearch: (value: string) => void;
  setStatusFilter: (statuses: string[]) => void;
  setTagFilter: (tags: string[]) => void;
  setGroupId: (id: string | null) => void;
  setSortBy: (field: "name" | "updatedAt" | "deployedAt") => void;
  setSortOrder: (order: "asc" | "desc") => void;
  clearFilters: () => void;
} {
  const searchParams = useSearchParams();
  const router = useRouter();

  const search = searchParams.get("search") ?? "";
  const statusFilter = searchParams.get("status")?.split(",").filter(Boolean) ?? [];
  const tagFilter = searchParams.get("tags")?.split(",").filter(Boolean) ?? [];
  const groupId = searchParams.get("groupId") ?? null;
  const sortBy = (searchParams.get("sortBy") as PipelineListFilters["sortBy"]) ?? "updatedAt";
  const sortOrder = (searchParams.get("sortOrder") as PipelineListFilters["sortOrder"]) ?? "desc";

  const updateParams = useCallback(
    (updater: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      updater(params);
      router.replace(`/pipelines?${params.toString()}`, { scroll: false });
    },
    [searchParams, router],
  );

  const setSearch = useCallback(
    (value: string) => updateParams((p) => {
      if (value) p.set("search", value);
      else p.delete("search");
    }),
    [updateParams],
  );

  const setStatusFilter = useCallback(
    (statuses: string[]) => updateParams((p) => {
      if (statuses.length > 0) p.set("status", statuses.join(","));
      else p.delete("status");
    }),
    [updateParams],
  );

  const setTagFilter = useCallback(
    (tags: string[]) => updateParams((p) => {
      if (tags.length > 0) p.set("tags", tags.join(","));
      else p.delete("tags");
    }),
    [updateParams],
  );

  const setGroupId = useCallback(
    (id: string | null) => updateParams((p) => {
      if (id) p.set("groupId", id);
      else p.delete("groupId");
    }),
    [updateParams],
  );

  const setSortBy = useCallback(
    (field: PipelineListFilters["sortBy"]) => updateParams((p) => {
      p.set("sortBy", field);
    }),
    [updateParams],
  );

  const setSortOrder = useCallback(
    (order: PipelineListFilters["sortOrder"]) => updateParams((p) => {
      p.set("sortOrder", order);
    }),
    [updateParams],
  );

  const clearFilters = useCallback(
    () => updateParams((p) => {
      p.delete("search");
      p.delete("status");
      p.delete("tags");
      p.delete("groupId");
    }),
    [updateParams],
  );

  const hasActiveFilters =
    search.length > 0 ||
    statusFilter.length > 0 ||
    tagFilter.length > 0 ||
    groupId !== null;

  return {
    search, statusFilter, tagFilter, groupId, sortBy, sortOrder,
    hasActiveFilters,
    setSearch, setStatusFilter, setTagFilter, setGroupId,
    setSortBy, setSortOrder, clearFilters,
  };
}
