"use client";

import { useState, useMemo, useCallback, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  Plus,
  MoreHorizontal,
  Copy,
  Trash2,
  BarChart3,
  ArrowUpRight,
  Clock,
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  FolderOpen,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PromotePipelineDialog } from "@/components/promote-pipeline-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { formatEventsRate, formatBytesRate } from "@/lib/format";
import { aggregateProcessStatus } from "@/lib/pipeline-status";
import { tagBadgeClass, reductionBadgeClass } from "@/lib/badge-variants";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import {
  PipelineListToolbar,
  type SortField,
  type SortDirection,
} from "@/components/pipeline/pipeline-list-toolbar";
import { ManageGroupsDialog } from "@/components/pipeline/manage-groups-dialog";
import { BulkActionBar } from "@/components/pipeline/bulk-action-bar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  buildGroupTree,
  type GroupNode,
} from "@/components/pipeline/pipeline-group-tree";
import { usePipelineSidebarStore } from "@/stores/pipeline-sidebar-store";

// --- Helpers ---

function sumNodeStatuses(
  statuses: Array<{
    eventsIn: bigint;
    eventsOut: bigint;
    errorsTotal: bigint;
    eventsDiscarded: bigint;
    bytesIn: bigint;
    bytesOut: bigint;
  }>,
) {
  let eventsIn = BigInt(0),
    eventsOut = BigInt(0),
    errorsTotal = BigInt(0),
    eventsDiscarded = BigInt(0),
    bytesIn = BigInt(0),
    bytesOut = BigInt(0);
  for (const s of statuses) {
    eventsIn += BigInt(s.eventsIn);
    eventsOut += BigInt(s.eventsOut);
    errorsTotal += BigInt(s.errorsTotal);
    eventsDiscarded += BigInt(s.eventsDiscarded);
    bytesIn += BigInt(s.bytesIn);
    bytesOut += BigInt(s.bytesOut);
  }
  return { eventsIn, eventsOut, errorsTotal, eventsDiscarded, bytesIn, bytesOut };
}

function getUserInitials(
  user: { name?: string | null; email?: string | null } | null | undefined,
): string {
  if (user?.name) {
    const parts = user.name.trim().split(/\s+/);
    if (parts.length >= 2)
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  }
  if (user?.email) return user.email[0].toUpperCase();
  return "?";
}

function getReductionPercent(totals: {
  eventsIn: bigint;
  eventsOut: bigint;
}): number | null {
  const evIn = Number(totals.eventsIn);
  const evOut = Number(totals.eventsOut);
  if (evIn === 0) return null;
  return Math.max(0, (1 - evOut / evIn) * 100);
}

function formatUptime(seconds: number | null): string {
  if (seconds == null) return "\u2014";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

/** Derive display status string for a pipeline row. */
function derivePipelineStatus(
  pipeline: { isDraft: boolean; nodeStatuses: Array<{ status: string }> },
): string {
  if (pipeline.isDraft) return "Draft";
  const ps = aggregateProcessStatus(pipeline.nodeStatuses);
  if (ps === "RUNNING") return "Running";
  if (ps === "CRASHED") return "Crashed";
  if (ps === "STOPPED") return "Stopped";
  if (ps === "STARTING" || ps === "PENDING") return "Starting";
  return "Deployed";
}

// --- Health dot (inline, replaces PipelineHealthBadge) ---

function HealthDot({
  status,
  hasSlis,
}: {
  status: string | null | undefined;
  hasSlis: boolean;
}) {
  if (!status) return null;

  if (status === "no_data" && hasSlis) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block h-2 w-2 rounded-full bg-gray-400" />
        </TooltipTrigger>
        <TooltipContent>No Data — SLIs configured but no traffic yet</TooltipContent>
      </Tooltip>
    );
  }

  if (status === "no_data") return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            status === "healthy" ? "bg-green-500" : "bg-yellow-500"
          }`}
        />
      </TooltipTrigger>
      <TooltipContent>
        {status === "healthy" ? "All SLIs met" : "One or more SLIs breached"}
      </TooltipContent>
    </Tooltip>
  );
}

// --- Sortable column header ---

function SortableHeader({
  label,
  field,
  currentField,
  currentDirection,
  onSort,
  className,
}: {
  label: string;
  field: SortField;
  currentField: SortField;
  currentDirection: SortDirection;
  onSort: (field: SortField) => void;
  className?: string;
}) {
  const isActive = currentField === field;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1 hover:text-foreground transition-colors -ml-1 px-1 rounded"
      >
        {label}
        {isActive &&
          (currentDirection === "asc" ? (
            <ArrowUp className="h-3 w-3" />
          ) : (
            <ArrowDown className="h-3 w-3" />
          ))}
      </button>
    </TableHead>
  );
}

// --- Page component ---

export default function PipelinesPage() {
  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  // --- Filter / sort state ---
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const groupId = usePipelineSidebarStore((s) => s.selectedGroupId);
  const manageGroupsOpen = usePipelineSidebarStore((s) => s.manageGroupsOpen);
  const setManageGroupsOpen = usePipelineSidebarStore((s) => s.setManageGroupsOpen);
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection("asc");
      }
    },
    [sortField],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedPipelineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (ids: string[]) => {
      setSelectedPipelineIds((prev) => {
        const allSelected = ids.every((id) => prev.has(id));
        if (allSelected) return new Set();
        return new Set(ids);
      });
    },
    [],
  );

  // --- Data queries ---

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );

  const environments = environmentsQuery.data ?? [];
  const effectiveEnvId = selectedEnvironmentId || environments[0]?.id || "";

  const pipelinesQuery = useQuery(
    trpc.pipeline.list.queryOptions(
      { environmentId: effectiveEnvId },
      { enabled: !!effectiveEnvId, refetchInterval: 30_000 },
    ),
  );

  const pipelines = useMemo(() => pipelinesQuery.data ?? [], [pipelinesQuery.data]);

  // Poll live rates from MetricStore for the pipelines table
  const liveRatesQuery = useQuery(
    trpc.metrics.getLiveRates.queryOptions(
      { environmentId: effectiveEnvId },
      { enabled: !!effectiveEnvId, refetchInterval: 15_000 },
    ),
  );
  const liveRates = useMemo(() => liveRatesQuery.data?.rates ?? {}, [liveRatesQuery.data]);

  // Fetch pending deploy requests for the current environment
  const pendingRequestsQuery = useQuery(
    trpc.deploy.listPendingRequests.queryOptions(
      { environmentId: effectiveEnvId },
      { enabled: !!effectiveEnvId },
    ),
  );
  const pendingRequests = pendingRequestsQuery.data ?? [];
  const pendingByPipeline = new Map<string, number>();
  for (const req of pendingRequests) {
    pendingByPipeline.set(
      req.pipelineId,
      (pendingByPipeline.get(req.pipelineId) ?? 0) + 1,
    );
  }

  // --- Batch health query (replaces per-row PipelineHealthBadge) ---
  const nonDraftPipelineIds = useMemo(
    () => pipelines.filter((p) => !p.isDraft).map((p) => p.id),
    [pipelines],
  );

  const batchHealthQuery = useQuery(
    trpc.pipeline.batchHealth.queryOptions(
      { pipelineIds: nonDraftPipelineIds },
      {
        enabled: nonDraftPipelineIds.length > 0,
        refetchInterval: 30_000,
      },
    ),
  );
  const healthData = batchHealthQuery.data ?? {};

  // --- Available tags (for toolbar) ---
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const p of pipelines) {
      for (const t of (p.tags as string[]) ?? []) {
        tagSet.add(t);
      }
    }
    return [...tagSet].sort();
  }, [pipelines]);

  const queryClient = useQueryClient();

  // --- Pipeline groups ---
  const groupsQuery = useQuery(
    trpc.pipelineGroup.list.queryOptions(
      { environmentId: effectiveEnvId },
      { enabled: !!effectiveEnvId },
    ),
  );
  // Extended groups with parentId for "Move to group" nested menu
  const groupsWithParent = useMemo(
    () =>
      (groupsQuery.data ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        color: g.color,
        parentId: g.parentId ?? null,
      })),
    [groupsQuery.data],
  );

  // Build group tree for "Move to group" nested menu
  const groupTree = useMemo(
    () => buildGroupTree(groupsWithParent),
    [groupsWithParent],
  );

  // --- "Move to group" mutation ---
  const setGroupMutation = useMutation(
    trpc.pipeline.update.mutationOptions({
      onSuccess: () => {
        toast.success("Pipeline group updated");
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.list.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.pipelineGroup.list.queryKey() });
      },
      onError: (err) => toast.error(err.message || "Failed to update group"),
    }),
  );

  // --- Filtered + sorted pipelines ---
  const filteredPipelines = useMemo(() => {
    let result = pipelines;

    // Group filter
    if (groupId) {
      result = result.filter((p) => p.groupId === groupId);
    }

    // Search by name (case-insensitive)
    if (search) {
      const lc = search.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(lc));
    }

    // Status filter
    if (statusFilter.length > 0) {
      result = result.filter((p) =>
        statusFilter.includes(derivePipelineStatus(p)),
      );
    }

    // Tag filter
    if (tagFilter.length > 0) {
      result = result.filter((p) => {
        const tags = (p.tags as string[]) ?? [];
        return tagFilter.some((t) => tags.includes(t));
      });
    }

    // Sort
    const sorted = [...result];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "status": {
          const sa = derivePipelineStatus(a);
          const sb = derivePipelineStatus(b);
          cmp = sa.localeCompare(sb);
          break;
        }
        case "throughput": {
          const ra = liveRates[a.id]?.eventsPerSec ?? 0;
          const rb = liveRates[b.id]?.eventsPerSec ?? 0;
          cmp = ra - rb;
          break;
        }
        case "updated":
          cmp =
            new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [pipelines, search, statusFilter, tagFilter, groupId, sortField, sortDirection, liveRates]);

  // --- Mutations ---

  const router = useRouter();

  const cloneMutation = useMutation(
    trpc.pipeline.clone.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Cloned as "${data.name}"`);
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.list.queryKey(),
        });
        router.push(`/pipelines/${data.id}`);
      },
      onError: (err) =>
        toast.error(err.message || "Failed to clone pipeline"),
    }),
  );

  const deleteMutation = useMutation(
    trpc.pipeline.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Pipeline deleted");
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.list.queryKey(),
        });
      },
      onError: (err) =>
        toast.error(err.message || "Failed to delete pipeline"),
    }),
  );

  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<{
    id: string;
    name: string;
    environmentId: string;
  } | null>(null);

  // --- Loading / error states ---

  const isLoading =
    environmentsQuery.isLoading || pipelinesQuery.isLoading;

  if (pipelinesQuery.isError) {
    return (
      <div className="space-y-6">
        <QueryError
          message="Failed to load pipelines"
          onRetry={() => pipelinesQuery.refetch()}
        />
      </div>
    );
  }

  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter([]);
    setTagFilter([]);
    usePipelineSidebarStore.getState().setSelectedGroupId(null);
  };

  // Recursive renderer for nested "Move to group" dropdown items
  function renderGroupMenuItems(
    nodes: GroupNode[],
    depth: number,
    onMove: (groupId: string | null) => void,
  ): React.ReactNode {
    return nodes.map((node) => (
      <Fragment key={node.id}>
        <DropdownMenuItem
          onClick={() => onMove(node.id)}
          style={{ paddingLeft: `${(depth + 1) * 12}px` }}
        >
          <span
            className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: node.color ?? "#64748b" }}
          />
          {node.name}
        </DropdownMenuItem>
        {node.children.length > 0 &&
          renderGroupMenuItems(node.children, depth + 1, onMove)}
      </Fragment>
    ));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href="/pipelines/dependencies">
            <Network className="mr-1.5 h-3.5 w-3.5" />
            Dependencies
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/pipelines/new">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Pipeline
          </Link>
        </Button>
      </div>

      <div className="space-y-4">
          {/* Toolbar — always shown when pipelines exist, even during loading */}
          {!isLoading && pipelines.length > 0 && (
            <PipelineListToolbar
              search={search}
              onSearchChange={setSearch}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              tagFilter={tagFilter}
              onTagFilterChange={setTagFilter}
              availableTags={availableTags}
            />
          )}

          {selectedPipelineIds.size > 0 && (
            <BulkActionBar
              selectedIds={[...selectedPipelineIds]}
              onClearSelection={() => setSelectedPipelineIds(new Set())}
            />
          )}

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : pipelines.length === 0 ? (
            <EmptyState
              title="No pipelines yet"
              action={{
                label: "Create your first pipeline",
                href: "/pipelines/new",
              }}
            />
          ) : filteredPipelines.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground">No pipelines match your filters</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={clearAllFilters}
              >
                Clear filters
              </Button>
            </div>
          ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={
                    filteredPipelines.length > 0 &&
                    filteredPipelines.every((p) => selectedPipelineIds.has(p.id))
                  }
                  onCheckedChange={() =>
                    toggleSelectAll(filteredPipelines.map((p) => p.id))
                  }
                  aria-label="Select all"
                />
              </TableHead>
              <SortableHeader
                label="Name"
                field="name"
                currentField={sortField}
                currentDirection={sortDirection}
                onSort={handleSort}
              />
              <TableHead>Labels</TableHead>
              <SortableHeader
                label="Status"
                field="status"
                currentField={sortField}
                currentDirection={sortDirection}
                onSort={handleSort}
              />
              <TableHead className="text-right">Uptime</TableHead>
              <TableHead className="text-center">Health</TableHead>
              <SortableHeader
                label="Events/sec In"
                field="throughput"
                currentField={sortField}
                currentDirection={sortDirection}
                onSort={handleSort}
                className="text-right"
              />
              <TableHead className="text-right">Bytes/sec In</TableHead>
              <TableHead className="text-right">Reduction</TableHead>
              <TableHead>Created</TableHead>
              <SortableHeader
                label="Last Updated"
                field="updated"
                currentField={sortField}
                currentDirection={sortDirection}
                onSort={handleSort}
              />
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <StaggerList as="tbody" className="[&_tr:last-child]:border-0">
            {filteredPipelines.map((pipeline) => {
              const hasStats = pipeline.nodeStatuses.length > 0;
              const totals = hasStats
                ? sumNodeStatuses(pipeline.nodeStatuses)
                : null;
              const health = healthData[pipeline.id];
              return (
                <StaggerItem
                  as="tr"
                  key={pipeline.id}
                  className="hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors cursor-pointer"
                >
                  <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedPipelineIds.has(pipeline.id)}
                      onCheckedChange={() => toggleSelect(pipeline.id)}
                      aria-label={`Select ${pipeline.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/pipelines/${pipeline.id}`}
                      className="hover:underline"
                    >
                      {pipeline.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {(() => {
                      const tags = (pipeline.tags as string[]) ?? [];
                      if (tags.length === 0) return null;
                      if (tags.length === 1) {
                        return (
                          <Badge
                            variant="outline"
                            size="sm"
                            className={tagBadgeClass(tags[0])}
                          >
                            {tags[0]}
                          </Badge>
                        );
                      }
                      return (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button className="cursor-pointer rounded-md hover:bg-muted/50 px-1 py-0.5 transition-colors">
                              <Badge variant="secondary" size="sm">
                                {tags.length} labels
                              </Badge>
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-auto p-3"
                            align="start"
                          >
                            <p className="mb-2 text-sm font-medium">Labels</p>
                            <div className="flex flex-wrap gap-1.5">
                              {tags.map((tag) => (
                                <Badge
                                  key={tag}
                                  variant="outline"
                                  size="sm"
                                  className={tagBadgeClass(tag)}
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </PopoverContent>
                        </Popover>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {pipeline.isDraft ? (
                        <Badge variant="secondary">Draft</Badge>
                      ) : (
                        (() => {
                          const ps = aggregateProcessStatus(
                            pipeline.nodeStatuses,
                          );
                          if (ps === "RUNNING")
                            return <Badge variant="default">Running</Badge>;
                          if (ps === "CRASHED")
                            return (
                              <Badge variant="destructive">Crashed</Badge>
                            );
                          if (ps === "STOPPED")
                            return <Badge variant="outline">Stopped</Badge>;
                          if (ps === "STARTING" || ps === "PENDING")
                            return (
                              <Badge variant="secondary">Starting...</Badge>
                            );
                          return <Badge variant="default">Deployed</Badge>;
                        })()
                      )}
                      {!pipeline.isDraft &&
                        pipeline.hasUndeployedChanges && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              Undeployed changes
                            </TooltipContent>
                          </Tooltip>
                        )}
                      {pendingByPipeline.has(pipeline.id) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          </TooltipTrigger>
                          <TooltipContent>Pending Approval</TooltipContent>
                        </Tooltip>
                      )}
                      {pipeline.hasStaleComponents && (
                        <Badge
                          variant="secondary"
                          className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                          title={`Updates available for: ${pipeline.staleComponentNames?.join(", ")}`}
                        >
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Updates available
                        </Badge>
                      )}
                      {((pipeline.upstreamDepCount ?? 0) > 0 ||
                        (pipeline.downstreamDepCount ?? 0) > 0) && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Link href="/pipelines/dependencies">
                              <Network className="h-3.5 w-3.5 text-muted-foreground" />
                            </Link>
                          </TooltipTrigger>
                          <TooltipContent>
                            {[
                              (pipeline.upstreamDepCount ?? 0) > 0 &&
                                `${pipeline.upstreamDepCount} upstream`,
                              (pipeline.downstreamDepCount ?? 0) > 0 &&
                                `${pipeline.downstreamDepCount} downstream`,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TableCell>
                  {/* Uptime */}
                  <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                    {formatUptime(pipeline.minUptimeSeconds)}
                  </TableCell>
                  {/* Health — batch data instead of per-row query */}
                  <TableCell className="text-center">
                    {pipeline.isDraft ? (
                      <span className="text-sm text-muted-foreground">--</span>
                    ) : (
                      <HealthDot
                        status={health?.status ?? null}
                        hasSlis={(health?.slis?.length ?? 0) > 0}
                      />
                    )}
                  </TableCell>
                  {/* Events/sec In */}
                  <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                    {liveRates[pipeline.id]
                      ? formatEventsRate(
                          liveRates[pipeline.id].eventsPerSec,
                        )
                      : "—"}
                  </TableCell>
                  {/* Bytes/sec In */}
                  <TableCell className="text-right font-mono text-sm tabular-nums text-muted-foreground">
                    {liveRates[pipeline.id]
                      ? formatBytesRate(
                          liveRates[pipeline.id].bytesPerSec,
                        )
                      : "—"}
                  </TableCell>
                  {/* Reduction */}
                  <TableCell className="text-right tabular-nums">
                    {(() => {
                      const pct = totals
                        ? getReductionPercent(totals)
                        : null;
                      if (pct == null)
                        return (
                          <span className="text-sm text-muted-foreground">
                            —
                          </span>
                        );
                      return (
                        <Badge
                          variant="outline"
                          className={reductionBadgeClass(pct)}
                        >
                          {pct.toFixed(0)}%
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  {/* Created */}
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Avatar className="h-5 w-5">
                              {pipeline.createdBy?.image && (
                                <AvatarImage
                                  src={pipeline.createdBy.image}
                                  alt={pipeline.createdBy.name ?? ""}
                                />
                              )}
                              <AvatarFallback className="text-[10px]">
                                {getUserInitials(pipeline.createdBy)}
                              </AvatarFallback>
                            </Avatar>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {pipeline.createdBy?.name ??
                            pipeline.createdBy?.email ??
                            "Unknown"}
                        </TooltipContent>
                      </Tooltip>
                      <span className="text-sm text-muted-foreground">
                        {new Date(pipeline.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </TableCell>
                  {/* Last Updated */}
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Avatar className="h-5 w-5">
                              {pipeline.updatedBy?.image && (
                                <AvatarImage
                                  src={pipeline.updatedBy.image}
                                  alt={pipeline.updatedBy.name ?? ""}
                                />
                              )}
                              <AvatarFallback className="text-[10px]">
                                {getUserInitials(pipeline.updatedBy)}
                              </AvatarFallback>
                            </Avatar>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {pipeline.updatedBy?.name ??
                            pipeline.updatedBy?.email ??
                            "Unknown"}
                        </TooltipContent>
                      </Tooltip>
                      <span className="text-sm text-muted-foreground">
                        {new Date(pipeline.updatedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label="Pipeline actions"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/pipelines/${pipeline.id}/metrics`}>
                            <BarChart3 className="mr-2 h-4 w-4" />
                            Metrics
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            cloneMutation.mutate({ pipelineId: pipeline.id })
                          }
                          disabled={cloneMutation.isPending}
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Clone
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            setPromoteTarget({
                              id: pipeline.id,
                              name: pipeline.name,
                              environmentId: effectiveEnvId,
                            })
                          }
                        >
                          <ArrowUpRight className="mr-2 h-4 w-4" />
                          Promote to...
                        </DropdownMenuItem>
                        {groupTree.length > 0 && (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <FolderOpen className="mr-2 h-4 w-4" />
                              Move to group
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              <DropdownMenuItem
                                onClick={() =>
                                  setGroupMutation.mutate({ id: pipeline.id, groupId: null })
                                }
                              >
                                <span className="text-muted-foreground">No group</span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {renderGroupMenuItems(groupTree, 0, (gid) =>
                                setGroupMutation.mutate({ id: pipeline.id, groupId: gid })
                              )}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() =>
                            setDeleteTarget({
                              id: pipeline.id,
                              name: pipeline.name,
                            })
                          }
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </StaggerItem>
              );
            })}
          </StaggerList>
        </Table>
          )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete pipeline?"
        description={
          <>
            This will permanently delete &quot;{deleteTarget?.name}&quot; and
            all its versions. This cannot be undone.
          </>
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteMutation.isPending}
        pendingLabel="Deleting..."
        onConfirm={() => {
          if (deleteTarget) {
            deleteMutation.mutate({ id: deleteTarget.id });
            setDeleteTarget(null);
          }
        }}
      />

      {promoteTarget && (
        <PromotePipelineDialog
          open={!!promoteTarget}
          onOpenChange={(open) => {
            if (!open) setPromoteTarget(null);
          }}
          pipeline={promoteTarget}
        />
      )}

      {effectiveEnvId && (
        <ManageGroupsDialog
          open={manageGroupsOpen}
          onOpenChange={setManageGroupsOpen}
          environmentId={effectiveEnvId}
        />
      )}
    </div>
  );
}
