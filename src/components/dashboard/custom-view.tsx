"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Server,
  Activity,
  BarChart3,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useEnvironmentStore } from "@/stores/environment-store";
import {
  MetricsFilterBar,
  type TimeRange,
  type GroupBy,
} from "@/components/dashboard/metrics-filter-bar";
import { MetricChart } from "@/components/dashboard/metric-chart";
import { formatSI, formatBytesRate, formatEventsRate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PanelId } from "@/components/dashboard/view-builder-dialog";

/** Derive an overall status for a pipeline from its node statuses */
function derivePipelineStatus(
  nodes: Array<{ pipelineStatus: string }>
): string {
  if (nodes.length === 0) return "PENDING";
  if (nodes.some((n) => n.pipelineStatus === "CRASHED")) return "CRASHED";
  if (nodes.some((n) => n.pipelineStatus === "RUNNING")) return "RUNNING";
  if (nodes.some((n) => n.pipelineStatus === "STARTING")) return "STARTING";
  if (nodes.every((n) => n.pipelineStatus === "STOPPED")) return "STOPPED";
  return nodes[0].pipelineStatus;
}

interface DashboardViewData {
  id: string;
  name: string;
  panels: unknown; // Json field — string[] at runtime
  filters: unknown; // Json field — { pipelineIds?: string[], nodeIds?: string[] }
}

interface CustomViewProps {
  view: DashboardViewData;
}

export function CustomView({ view }: CustomViewProps) {
  const trpc = useTRPC();
  const { selectedEnvironmentId } = useEnvironmentStore();

  // Parse view data
  const panels = (view.panels ?? []) as PanelId[];
  const savedFilters = (view.filters ?? {}) as {
    pipelineIds?: string[];
    nodeIds?: string[];
  };

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(
    savedFilters.nodeIds ?? []
  );
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>(
    savedFilters.pipelineIds ?? []
  );
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [groupBy, setGroupBy] = useState<GroupBy>("pipeline");

  const refreshInterval: Record<TimeRange, number> = {
    "1h": 15_000,
    "6h": 60_000,
    "1d": 60_000,
    "7d": 300_000,
  };

  // Determine which data to fetch based on selected panels
  const needsChartData = panels.some((p) =>
    [
      "events-in-out",
      "bytes-in-out",
      "error-rate",
      "cpu-usage",
      "memory-usage",
      "disk-io",
      "network-io",
    ].includes(p)
  );
  const needsStats = panels.some((p) =>
    ["data-reduction", "node-health-summary", "pipeline-health-summary"].includes(p)
  );
  const needsPipelineCards = panels.includes("pipeline-health-summary");

  const chartData = useQuery({
    ...trpc.dashboard.chartMetrics.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      nodeIds: selectedNodeIds,
      pipelineIds: selectedPipelineIds,
      range: timeRange,
      groupBy,
    }),
    refetchInterval: refreshInterval[timeRange],
    enabled: !!selectedEnvironmentId && needsChartData,
  });

  const stats = useQuery({
    ...trpc.dashboard.stats.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
    }),
    enabled: !!selectedEnvironmentId && needsStats,
  });

  const pipelineCards = useQuery({
    ...trpc.dashboard.pipelineCards.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
    }),
    refetchInterval: 15_000,
    enabled: !!selectedEnvironmentId && needsPipelineCards,
  });

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

  // Show filter bar if we have any chart panels
  const showFilterBar = needsChartData;

  return (
    <div className="space-y-6">
      {/* Filter bar (if chart panels are present) */}
      {showFilterBar && (
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
      )}

      {/* Summary panels (rendered at the top if present) */}
      {(panels.includes("node-health-summary") ||
        panels.includes("pipeline-health-summary") ||
        panels.includes("data-reduction")) && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {panels.includes("node-health-summary") && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    Node Health
                  </p>
                  <Server className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {stats.data?.fleet.healthy != null &&
                    stats.data.fleet.healthy > 0 && (
                      <StatusBadge variant="healthy">
                        {stats.data.fleet.healthy} Healthy
                      </StatusBadge>
                    )}
                  {stats.data?.fleet.degraded != null &&
                    stats.data.fleet.degraded > 0 && (
                      <StatusBadge variant="degraded">
                        {stats.data.fleet.degraded} Degraded
                      </StatusBadge>
                    )}
                  {stats.data?.fleet.unreachable != null &&
                    stats.data.fleet.unreachable > 0 && (
                      <StatusBadge variant="error">
                        {stats.data.fleet.unreachable} Unreachable
                      </StatusBadge>
                    )}
                  {stats.data && stats.data.nodes === 0 && (
                    <span className="text-sm text-muted-foreground">
                      No nodes
                    </span>
                  )}
                </div>
                <p className="mt-1 text-2xl font-bold">
                  {stats.data?.nodes ?? 0}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    total
                  </span>
                </p>
              </CardContent>
            </Card>
          )}

          {panels.includes("pipeline-health-summary") && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    Pipeline Health
                  </p>
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {pipelineStatusCounts.running > 0 && (
                    <StatusBadge variant="healthy">
                      {pipelineStatusCounts.running} Running
                    </StatusBadge>
                  )}
                  {pipelineStatusCounts.stopped > 0 && (
                    <StatusBadge variant="neutral">
                      {pipelineStatusCounts.stopped} Stopped
                    </StatusBadge>
                  )}
                  {pipelineStatusCounts.crashed > 0 && (
                    <StatusBadge variant="error">
                      {pipelineStatusCounts.crashed} Crashed
                    </StatusBadge>
                  )}
                  {stats.data && stats.data.pipelines === 0 && (
                    <span className="text-sm text-muted-foreground">
                      No pipelines
                    </span>
                  )}
                </div>
                <p className="mt-1 text-2xl font-bold">
                  {stats.data?.pipelines ?? 0}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    deployed
                  </span>
                </p>
              </CardContent>
            </Card>
          )}

          {panels.includes("data-reduction") && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    Data Reduction
                  </p>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </div>
                {stats.data?.reduction?.percent != null ? (
                  <>
                    <p
                      className={cn(
                        "mt-1 text-2xl font-bold",
                        stats.data.reduction.percent > 50
                          ? "text-green-600 dark:text-green-400"
                          : stats.data.reduction.percent > 10
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                      )}
                    >
                      {stats.data.reduction.percent.toFixed(0)}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatEventsRate(stats.data.reduction.eventsIn / 3600)}{" "}
                      -{"> "}
                      {formatEventsRate(stats.data.reduction.eventsOut / 3600)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-2xl font-bold text-muted-foreground">
                      --
                    </p>
                    <p className="text-xs text-muted-foreground">
                      No traffic data
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Chart panels in a 2-column responsive grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {panels.includes("events-in-out") && (
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
        )}

        {panels.includes("bytes-in-out") && (
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
        )}

        {panels.includes("error-rate") && (
          <MetricChart
            title="Errors & Discarded"
            data={chartData.data?.pipeline.errors ?? {}}
            dataSecondary={chartData.data?.pipeline.discarded ?? {}}
            variant="area"
            primaryLabel=" Errors"
            secondaryLabel=" Discarded"
            yFormatter={formatSI}
            timeRange={timeRange}
            height={220}
          />
        )}

        {panels.includes("cpu-usage") && (
          <MetricChart
            title="CPU Usage"
            icon={<Cpu className="h-4 w-4" />}
            data={chartData.data?.system.cpu ?? {}}
            yFormatter={(v) => `${v.toFixed(0)}%`}
            yDomain={[0, 100]}
            timeRange={timeRange}
            height={220}
          />
        )}

        {panels.includes("memory-usage") && (
          <MetricChart
            title="Memory Usage"
            icon={<MemoryStick className="h-4 w-4" />}
            data={chartData.data?.system.memory ?? {}}
            yFormatter={(v) => `${v.toFixed(0)}%`}
            yDomain={[0, 100]}
            timeRange={timeRange}
            height={220}
          />
        )}

        {panels.includes("disk-io") && (
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
        )}

        {panels.includes("network-io") && (
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
        )}
      </div>
    </div>
  );
}
