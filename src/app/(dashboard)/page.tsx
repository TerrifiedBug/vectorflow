"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  Server,
  Activity,
  GitBranch,
  BarChart3,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Plus,
  Pencil,
  Trash2,
  Timer,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useEnvironmentStore } from "@/stores/environment-store";
import {
  MetricsFilterBar,
  type TimeRange,
  type GroupBy,
} from "@/components/dashboard/metrics-filter-bar";
import { MetricsSection } from "@/components/dashboard/metrics-section";
import { MetricChart } from "@/components/dashboard/metric-chart";
import { ViewBuilderDialog } from "@/components/dashboard/view-builder-dialog";
import { CustomView } from "@/components/dashboard/custom-view";
import { formatSI, formatBytesRate, formatEventsRate, formatLatency } from "@/lib/format";
import { derivePipelineStatus } from "@/lib/pipeline-status";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { usePollingInterval } from "@/hooks/use-polling-interval";

export default function DashboardPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { selectedEnvironmentId } = useEnvironmentStore();

  // ── Custom Views ──────────────────────────────────────────────
  const viewsQuery = useQuery(trpc.dashboard.listViews.queryOptions());
  const [activeView, setActiveView] = useState<string | null>(null); // null = default
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editView, setEditView] = useState<{
    id: string;
    name: string;
    panels: string[];
  } | null>(null);

  const deleteMutation = useMutation(
    trpc.dashboard.deleteView.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({
          queryKey: [["dashboard", "listViews"]],
        });
        // Only reset to default if the deleted view was the one being viewed
        if (activeView === variables.id) {
          setActiveView(null);
        }
      },
    })
  );

  // Find the active custom view data
  const activeViewData = useMemo(
    () => viewsQuery.data?.find((v) => v.id === activeView) ?? null,
    [viewsQuery.data, activeView]
  );

  // ── Default View Data ─────────────────────────────────────────
  const stats = useQuery({
    ...trpc.dashboard.stats.queryOptions({ environmentId: selectedEnvironmentId ?? "" }),
    enabled: !!selectedEnvironmentId && activeView === null,
  });
  const pipelineCardsPolling = usePollingInterval(15_000);
  const pipelineCards = useQuery({
    ...trpc.dashboard.pipelineCards.queryOptions({ environmentId: selectedEnvironmentId ?? "" }),
    refetchInterval: pipelineCardsPolling,
    enabled: !!selectedEnvironmentId && activeView === null,
  });

  // Compute pipeline status counts for summary bar
  const pipelineStatusCounts = useMemo(() => {
    if (!pipelineCards.data) return { running: 0, stopped: 0, crashed: 0 };
    let running = 0;
    let stopped = 0;
    let crashed = 0;
    for (const p of pipelineCards.data) {
      const status = derivePipelineStatus(p.nodes);
      if (status === "RUNNING" || status === "STARTING") running++;
      else if (status === "STOPPED") stopped++;
      else if (status === "CRASHED") crashed++;
    }
    return { running, stopped, crashed };
  }, [pipelineCards.data]);

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [groupBy, setGroupBy] = useState<GroupBy>("pipeline");

  const refreshInterval: Record<TimeRange, number> = {
    "1h": 15_000,
    "6h": 60_000,
    "1d": 60_000,
    "7d": 300_000,
  };

  const chartPolling = usePollingInterval(refreshInterval[timeRange]);

  const chartData = useQuery({
    ...trpc.dashboard.chartMetrics.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      nodeIds: selectedNodeIds,
      pipelineIds: selectedPipelineIds,
      range: timeRange,
      groupBy,
    }),
    refetchInterval: chartPolling,
    enabled: !!selectedEnvironmentId && activeView === null,
  });

  if (!selectedEnvironmentId) {
    return <EmptyState title="Select an environment to view the dashboard" />;
  }

  if (stats.isError) {
    return <QueryError message="Failed to load dashboard data" onRetry={() => stats.refetch()} />;
  }

  return (
    <div className="space-y-6">
      {/* ── Tab Bar ────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b px-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveView(null)}
          className={cn(
            "shrink-0 cursor-pointer px-3 py-2 text-sm font-medium transition-colors",
            activeView === null
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Default
        </button>
        {viewsQuery.data?.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => setActiveView(view.id)}
            className={cn(
              "group relative shrink-0 flex cursor-pointer items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors",
              activeView === view.id
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {view.name}
            {/* Edit / Delete icons visible on hover or when active */}
            <span
              className={cn(
                "inline-flex items-center gap-0.5 ml-1",
                activeView === view.id
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100"
              )}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditView({
                    id: view.id,
                    name: view.name,
                    panels: view.panels as string[],
                  });
                }}
                className="relative cursor-pointer rounded p-1 transition-colors hover:bg-muted before:absolute before:-inset-1 before:content-['']"
                aria-label="Edit view"
                title="Edit view"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete "${view.name}"?`)) {
                    deleteMutation.mutate({ environmentId: selectedEnvironmentId!, id: view.id });
                  }
                }}
                className="relative cursor-pointer rounded p-1 transition-colors hover:bg-muted text-destructive before:absolute before:-inset-1 before:content-['']"
                aria-label="Delete view"
                title="Delete view"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCreateDialogOpen(true)}
          className="ml-auto shrink-0 flex cursor-pointer items-center gap-1 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New View
        </button>
      </div>

      {/* ── View Content ───────────────────────────────────────── */}
      {activeView !== null && activeViewData ? (
        <CustomView key={activeViewData.id} view={activeViewData} />
      ) : (
        <>
          {/* KPI Summary Cards */}
          {stats.isPending ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-4 w-24 mb-2" />
                    <Skeleton className="h-8 w-16" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
            {/* Total Nodes */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Total Nodes</p>
                  <Server className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums">{stats.data?.nodes ?? 0}</p>
              </CardContent>
            </Card>

            {/* Node Health */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Node Health</p>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {stats.data?.fleet.healthy != null && stats.data.fleet.healthy > 0 && (
                    <StatusBadge variant="healthy">{stats.data.fleet.healthy} Healthy</StatusBadge>
                  )}
                  {stats.data?.fleet.degraded != null && stats.data.fleet.degraded > 0 && (
                    <StatusBadge variant="degraded">{stats.data.fleet.degraded} Degraded</StatusBadge>
                  )}
                  {stats.data?.fleet.unreachable != null && stats.data.fleet.unreachable > 0 && (
                    <StatusBadge variant="error">{stats.data.fleet.unreachable} Unreachable</StatusBadge>
                  )}
                  {stats.data && stats.data.nodes === 0 && (
                    <span className="text-sm text-muted-foreground">No nodes</span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Total Pipelines */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Pipelines</p>
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums">{stats.data?.pipelines ?? 0}</p>
              </CardContent>
            </Card>

            {/* Pipeline Status */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Pipeline Status</p>
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {pipelineStatusCounts.running > 0 && (
                    <StatusBadge variant="healthy">{pipelineStatusCounts.running} Running</StatusBadge>
                  )}
                  {pipelineStatusCounts.stopped > 0 && (
                    <StatusBadge variant="neutral">{pipelineStatusCounts.stopped} Stopped</StatusBadge>
                  )}
                  {pipelineStatusCounts.crashed > 0 && (
                    <StatusBadge variant="error">{pipelineStatusCounts.crashed} Crashed</StatusBadge>
                  )}
                  {stats.data && stats.data.pipelines === 0 && (
                    <span className="text-sm text-muted-foreground">No pipelines</span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Log Reduction */}
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">Log Reduction</p>
                </div>
                {stats.data?.reduction?.percent != null ? (
                  <>
                    <p className={cn(
                      "mt-1 text-2xl font-bold tabular-nums",
                      stats.data.reduction.percent > 50 ? "text-green-600 dark:text-green-400" :
                      stats.data.reduction.percent > 10 ? "text-amber-600 dark:text-amber-400" :
                      "text-muted-foreground"
                    )}>
                      {stats.data.reduction.percent.toFixed(0)}%
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {formatEventsRate(stats.data.reduction.eventsIn / 3600)} → {formatEventsRate(stats.data.reduction.eventsOut / 3600)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-2xl font-bold text-muted-foreground">—</p>
                    <p className="text-xs text-muted-foreground">No traffic data</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
          )}

          {/* Metrics Filter Bar */}
          <MetricsFilterBar
            nodes={chartData.data?.filterOptions.nodes ?? []}
            pipelines={chartData.data?.filterOptions.pipelines ?? []}
            selectedNodeIds={selectedNodeIds}
            selectedPipelineIds={selectedPipelineIds}
            timeRange={timeRange}
            onNodeChange={setSelectedNodeIds}
            onPipelineChange={setSelectedPipelineIds}
            onTimeRangeChange={setTimeRange}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
          />

          {/* Pipeline Metrics */}
          <MetricsSection title="Pipeline Metrics">
            <MetricChart
              title="Events In/Out per Second"
              data={chartData.data?.pipeline.eventsIn ?? {}}
              dataSecondary={chartData.data?.pipeline.eventsOut ?? {}}
              primaryLabel=" In"
              secondaryLabel=" Out"
              yFormatter={formatSI}
              timeRange={timeRange}
              height={250}
            />
            <MetricChart
              title="Bytes In/Out per Second"
              data={chartData.data?.pipeline.bytesIn ?? {}}
              dataSecondary={chartData.data?.pipeline.bytesOut ?? {}}
              primaryLabel=" In"
              secondaryLabel=" Out"
              yFormatter={(v) => formatBytesRate(v)}
              timeRange={timeRange}
              height={250}
            />
            <MetricChart
              title="Errors & Discarded"
              data={chartData.data?.pipeline.errors ?? {}}
              dataSecondary={chartData.data?.pipeline.discarded ?? {}}
              variant="area"
              primaryLabel=" Errors"
              secondaryLabel=" Discarded"
              yFormatter={formatSI}
              timeRange={timeRange}
              height={200}
            />
            <MetricChart
              title="Transform Latency"
              icon={<Timer className="h-4 w-4" />}
              data={chartData.data?.pipeline.latency ?? {}}
              variant="area"
              yFormatter={formatLatency}
              timeRange={timeRange}
              height={200}
            />
          </MetricsSection>

          {/* System Metrics */}
          <MetricsSection title="System Metrics">
            <div className="grid gap-4 md:grid-cols-2">
              <MetricChart
                title="CPU Usage"
                icon={<Cpu className="h-4 w-4" />}
                data={chartData.data?.system.cpu ?? {}}
                yFormatter={(v) => `${v.toFixed(0)}%`}
                yDomain={[0, 100]}
                timeRange={timeRange}
                height={220}
              />
              <MetricChart
                title="Memory Usage"
                icon={<MemoryStick className="h-4 w-4" />}
                data={chartData.data?.system.memory ?? {}}
                yFormatter={(v) => `${v.toFixed(0)}%`}
                yDomain={[0, 100]}
                timeRange={timeRange}
                height={220}
              />
              <MetricChart
                title="Disk I/O"
                icon={<HardDrive className="h-4 w-4" />}
                data={chartData.data?.system.diskRead ?? {}}
                dataSecondary={chartData.data?.system.diskWrite ?? {}}
                primaryLabel=" Read"
                secondaryLabel=" Write"
                yFormatter={(v) => formatBytesRate(v)}
                timeRange={timeRange}
                height={220}
              />
              <MetricChart
                title="Network I/O"
                icon={<Network className="h-4 w-4" />}
                data={chartData.data?.system.netRx ?? {}}
                dataSecondary={chartData.data?.system.netTx ?? {}}
                primaryLabel=" Rx"
                secondaryLabel=" Tx"
                yFormatter={(v) => formatBytesRate(v)}
                timeRange={timeRange}
                height={220}
              />
            </div>
          </MetricsSection>
        </>
      )}

      {/* ── Dialogs ────────────────────────────────────────────── */}
      <ViewBuilderDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        environmentId={selectedEnvironmentId ?? ""}
      />
      <ViewBuilderDialog
        open={editView !== null}
        onOpenChange={(open) => {
          if (!open) setEditView(null);
        }}
        environmentId={selectedEnvironmentId ?? ""}
        editView={editView ?? undefined}
      />
    </div>
  );
}
