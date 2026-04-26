"use client";

import { useState, Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { ChevronDown, ChevronRight, Rocket, ScrollText, Search } from "lucide-react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/ui/date-range-picker";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamStore } from "@/stores/team-store";
import { formatTimestamp } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { PageHeader } from "@/components/page-header";
import { DeploymentHistory } from "./deployments/page";
import { getAuditActionLabel } from "@/lib/audit-actions";

const ALL_VALUE = "__all__";
const SCIM_VALUE = "__SCIM__";

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
  return "bg-muted/50 text-muted-foreground";
}

export default function AuditPage() {
  const searchParams = useSearchParams();
  const defaultTab = searchParams.get("tab") === "deployments" ? "deployments" : "activity";
  const [activeTab, setActiveTab] = useState(defaultTab);

  const trpc = useTRPC();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  // Filter state
  const [actionFilter, setActionFilter] = useState<string>("");
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [environmentFilter, setEnvironmentFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Expanded row tracking
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Fetch filter options
  const actionsQuery = useQuery(trpc.audit.actions.queryOptions());
  const entityTypesQuery = useQuery(trpc.audit.entityTypes.queryOptions());
  const usersQuery = useQuery(trpc.audit.users.queryOptions());
  const teamsQuery = useQuery(trpc.team.list.queryOptions());
  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: (teamFilter || selectedTeamId)! },
      { enabled: !!(teamFilter || selectedTeamId) }
    )
  );
  const environments = environmentsQuery.data ?? [];

  // Build query input — explicit team filter overrides global team selector
  const effectiveTeamId = teamFilter || selectedTeamId;
  const effectiveEnvironmentId = environmentFilter || undefined;
  // Map entity type filter to entityTypes array for the query
  const entityTypesParam = entityTypeFilter
    ? entityTypeFilter === SCIM_VALUE
      ? ["ScimUser", "ScimGroup"]
      : [entityTypeFilter]
    : undefined;

  const queryInput = {
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(entityTypesParam ? { entityTypes: entityTypesParam } : {}),
    ...(userFilter ? { userId: userFilter } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(search ? { search } : {}),
    ...(effectiveTeamId ? { teamId: effectiveTeamId } : {}),
    ...(effectiveEnvironmentId ? { environmentId: effectiveEnvironmentId } : {}),
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
  const users = usersQuery.data ?? [];
  const teams = teamsQuery.data ?? [];

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

  // Show full-page skeleton on initial load (before filter options are ready)
  const isInitialLoad = logsQuery.isLoading && actionsQuery.isLoading;

  if (logsQuery.isError) {
    return (
      <div className="space-y-6">
        <QueryError message="Failed to load audit log" onRetry={() => logsQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Audit Log" description="Track all changes and actions across your VectorFlow instance." />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="activity" className="gap-1.5">
            <ScrollText className="h-4 w-4" />
            Activity Log
          </TabsTrigger>
          <TabsTrigger value="deployments" className="gap-1.5">
            <Rocket className="h-4 w-4" />
            Deployments
          </TabsTrigger>
        </TabsList>
        <TabsContent value="activity" className="space-y-6">

      {/* Filter bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Search */}
            <div className="flex flex-col gap-2">
              <label htmlFor="audit-search" className="text-xs text-muted-foreground">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="audit-search"
                  placeholder="Search actions, entities..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 w-[220px]"
                />
              </div>
            </div>

            {/* Action filter */}
            <div className="flex flex-col gap-2">
              <label htmlFor="audit-action" className="text-xs text-muted-foreground">Action</label>
              <Select
                value={actionFilter || ALL_VALUE}
                onValueChange={(v) =>
                  setActionFilter(v === ALL_VALUE ? "" : v)
                }
              >
                <SelectTrigger id="audit-action" className="w-[180px]">
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
            <div className="flex flex-col gap-2">
              <label htmlFor="audit-entity-type" className="text-xs text-muted-foreground">
                Entity Type
              </label>
              <Select
                value={entityTypeFilter || ALL_VALUE}
                onValueChange={(v) =>
                  setEntityTypeFilter(v === ALL_VALUE ? "" : v)
                }
              >
                <SelectTrigger id="audit-entity-type" className="w-[180px]">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All types</SelectItem>
                  <SelectItem value={SCIM_VALUE}>SCIM (All)</SelectItem>
                  {entityTypes.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* User filter */}
            <div className="flex flex-col gap-2">
              <label htmlFor="audit-user" className="text-xs text-muted-foreground">User</label>
              <Select
                value={userFilter || ALL_VALUE}
                onValueChange={(v) =>
                  setUserFilter(v === ALL_VALUE ? "" : v)
                }
              >
                <SelectTrigger id="audit-user" className="w-[180px]">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All users</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Team filter */}
            <div className="flex flex-col gap-2">
              <label htmlFor="audit-team" className="text-xs text-muted-foreground">Team</label>
              <Select
                value={teamFilter || ALL_VALUE}
                onValueChange={(v) => setTeamFilter(v === ALL_VALUE ? "" : v)}
              >
                <SelectTrigger id="audit-team" className="w-[180px]">
                  <SelectValue placeholder="All teams" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All teams</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Environment filter */}
            <div className="flex flex-col gap-2">
              <label htmlFor="audit-env" className="text-xs text-muted-foreground">Environment</label>
              <Select
                value={environmentFilter || ALL_VALUE}
                onValueChange={(v) => setEnvironmentFilter(v === ALL_VALUE ? "" : v)}
              >
                <SelectTrigger id="audit-env" className="w-[180px]">
                  <SelectValue placeholder="All environments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All environments</SelectItem>
                  {environments.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date range */}
            <div className="flex flex-col gap-2">
              <label htmlFor="date-range" className="text-xs text-muted-foreground">Date range</label>
              <DateRangePicker
                className="w-[280px]"
                value={
                  startDate || endDate
                    ? {
                        from: startDate ? new Date(startDate) : undefined,
                        to: endDate ? new Date(endDate) : undefined,
                      }
                    : undefined
                }
                onChange={(range: DateRange | undefined) => {
                  setStartDate(range?.from ? format(range.from, "yyyy-MM-dd") : "");
                  setEndDate(range?.to ? format(range.to, "yyyy-MM-dd") : "");
                }}
              />
            </div>

            {/* Clear filters */}
            {(actionFilter ||
              entityTypeFilter ||
              userFilter ||
              teamFilter ||
              environmentFilter ||
              startDate ||
              endDate ||
              search) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setActionFilter("");
                  setEntityTypeFilter("");
                  setUserFilter("");
                  setTeamFilter("");
                  setEnvironmentFilter("");
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
          {isInitialLoad && <Skeleton className="h-40 w-full" />}
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : allItems.length === 0 ? (
        <EmptyState
          title="No audit log entries found"
          description="Actions will appear here as they are performed"
        />
      ) : (
        <>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[30px]" />
                <TableHead className="whitespace-nowrap">Timestamp</TableHead>
                <TableHead>User</TableHead>
                <TableHead className="hidden xl:table-cell">IP Address</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity Type</TableHead>
                <TableHead className="hidden xl:table-cell max-w-[180px]">Entity ID</TableHead>
                <TableHead className="hidden lg:table-cell">Details</TableHead>
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
                          ? "cursor-pointer"
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
                          {entry.userName || entry.userEmail || entry.user?.name || entry.user?.email}
                        </span>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell text-sm text-muted-foreground whitespace-nowrap">
                        {entry.ipAddress || "\u2014"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`max-w-full truncate ${getActionColor(entry.action)}`}
                          title={entry.action}
                        >
                          {getAuditActionLabel(entry.action)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {entry.entityType}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell font-mono text-xs tabular-nums max-w-[180px] truncate" title={entry.entityId}>
                        {entry.entityId}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[300px] truncate">
                        {truncate(
                          entry.diff ??
                          (entry.metadata as Record<string, unknown>)?.input ??
                          entry.metadata
                        )}
                      </TableCell>
                    </TableRow>
                    {isExpanded && hasDetails && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={99} className="p-4">
                          <div className="space-y-3 min-w-0">
                            {entry.ipAddress && (
                              <div className="xl:hidden">
                                <p className="text-xs font-medium text-muted-foreground mb-1">IP Address</p>
                                <span className="text-xs font-mono tabular-nums">{entry.ipAddress}</span>
                              </div>
                            )}
                            {entry.entityId && (
                              <div className="xl:hidden">
                                <p className="text-xs font-medium text-muted-foreground mb-1">Entity ID</p>
                                <span className="text-xs font-mono tabular-nums break-all">{entry.entityId}</span>
                              </div>
                            )}
                            {hasMetadata && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-2">Details</p>
                                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
                                  {Object.entries(entry.metadata as Record<string, unknown>).map(([key, value]) => (
                                    <Fragment key={key}>
                                      <span className="font-medium text-muted-foreground capitalize whitespace-nowrap">
                                        {key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim()}
                                      </span>
                                      {typeof value === "object" && value !== null ? (
                                        <pre className="font-mono whitespace-pre-wrap break-all overflow-hidden">
                                          {JSON.stringify(value, null, 2)}
                                        </pre>
                                      ) : (
                                        <span className="font-mono break-all">
                                          {String(value ?? "\u2014")}
                                        </span>
                                      )}
                                    </Fragment>
                                  ))}
                                </div>
                              </div>
                            )}
                            {hasDiff && (
                              <div>
                                <p className="text-xs font-medium text-muted-foreground mb-2">Changes</p>
                                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
                                  {Object.entries(entry.diff as Record<string, unknown>).map(([key, value]) => (
                                    <Fragment key={key}>
                                      <span className="font-medium text-muted-foreground capitalize whitespace-nowrap">
                                        {key.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim()}
                                      </span>
                                      {typeof value === "object" && value !== null ? (
                                        <pre className="font-mono whitespace-pre-wrap break-all overflow-hidden">
                                          {JSON.stringify(value, null, 2)}
                                        </pre>
                                      ) : (
                                        <span className="font-mono break-all">
                                          {String(value ?? "\u2014")}
                                        </span>
                                      )}
                                    </Fragment>
                                  ))}
                                </div>
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

        </div>

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

        </TabsContent>
        <TabsContent value="deployments">
          <DeploymentHistory />
        </TabsContent>
      </Tabs>
    </div>
  );
}
