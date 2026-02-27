"use client";

import { useState, Fragment } from "react";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { ChevronDown, ChevronRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const ALL_VALUE = "__all__";

function formatTimestamp(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncate(value: unknown, maxLength = 80): string {
  if (value === null || value === undefined) return "-";
  const str =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + "...";
}

/** Color map for common action keywords */
function getActionColor(action: string): string {
  if (action.includes("created") || action.includes("create"))
    return "bg-green-500/15 text-green-700 dark:text-green-400";
  if (action.includes("updated") || action.includes("update"))
    return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
  if (action.includes("deleted") || action.includes("delete"))
    return "bg-red-500/15 text-red-700 dark:text-red-400";
  if (action.includes("deployed") || action.includes("deploy"))
    return "bg-purple-500/15 text-purple-700 dark:text-purple-400";
  return "bg-gray-500/15 text-gray-700 dark:text-gray-400";
}

export default function AuditPage() {
  const trpc = useTRPC();

  // Filter state
  const [actionFilter, setActionFilter] = useState<string>("");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Expanded row tracking
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Fetch filter options
  const actionsQuery = useQuery(trpc.audit.actions.queryOptions());
  const entityTypesQuery = useQuery(trpc.audit.entityTypes.queryOptions());

  // Build query input
  const queryInput = {
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(entityTypeFilter ? { entityType: entityTypeFilter } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(search ? { search } : {}),
  };

  // Infinite query for cursor-based pagination
  const logsQuery = useInfiniteQuery(
    trpc.audit.list.infiniteQueryOptions(queryInput, {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    })
  );

  const allItems = logsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const actions = actionsQuery.data ?? [];
  const entityTypes = entityTypesQuery.data ?? [];

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Audit Log</h2>
        <p className="text-muted-foreground">
          Track all actions performed in the system
        </p>
      </div>

      {/* Filter bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Search */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search actions, entities..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 w-[220px]"
                />
              </div>
            </div>

            {/* Action filter */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Action</label>
              <Select
                value={actionFilter || ALL_VALUE}
                onValueChange={(v) =>
                  setActionFilter(v === ALL_VALUE ? "" : v)
                }
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All actions</SelectItem>
                  {actions.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Entity type filter */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">
                Entity Type
              </label>
              <Select
                value={entityTypeFilter || ALL_VALUE}
                onValueChange={(v) =>
                  setEntityTypeFilter(v === ALL_VALUE ? "" : v)
                }
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All types</SelectItem>
                  {entityTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date range */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">From</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">To</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-[160px]"
              />
            </div>

            {/* Clear filters */}
            {(actionFilter ||
              entityTypeFilter ||
              startDate ||
              endDate ||
              search) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setActionFilter("");
                  setEntityTypeFilter("");
                  setStartDate("");
                  setEndDate("");
                  setSearch("");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {logsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : allItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No audit log entries found</p>
          <p className="text-sm text-muted-foreground mt-1">
            Actions will appear here as they are performed
          </p>
        </div>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30px]" />
                <TableHead>Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead>Entity ID</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allItems.map((entry) => {
                const isExpanded = expandedRows.has(entry.id);
                const hasDiff = entry.diff !== null;
                const hasMetadata = entry.metadata !== null;
                const hasDetails = hasDiff || hasMetadata;

                return (
                  <Fragment key={entry.id}>
                    <TableRow
                      className={
                        hasDetails
                          ? "cursor-pointer hover:bg-muted/50"
                          : ""
                      }
                      onClick={() => hasDetails && toggleRow(entry.id)}
                    >
                      <TableCell className="w-[30px] px-2">
                        {hasDetails &&
                          (isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          ))}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatTimestamp(entry.createdAt)}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">
                          {entry.user.name || entry.user.email}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={getActionColor(entry.action)}
                        >
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {entry.entityType}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs max-w-[200px] truncate">
                        {entry.entityId}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {truncate(entry.diff ?? entry.metadata)}
                      </TableCell>
                    </TableRow>
                    {isExpanded && hasDetails && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={7} className="p-4">
                          <div className="space-y-3">
                            {hasDiff && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  Diff
                                </p>
                                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-[300px]">
                                  {JSON.stringify(entry.diff, null, 2)}
                                </pre>
                              </div>
                            )}
                            {hasMetadata && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-1">
                                  Metadata
                                </p>
                                <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-[300px]">
                                  {JSON.stringify(entry.metadata, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>

          {/* Load more */}
          {logsQuery.hasNextPage && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => logsQuery.fetchNextPage()}
                disabled={logsQuery.isFetchingNextPage}
              >
                {logsQuery.isFetchingNextPage
                  ? "Loading more..."
                  : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
