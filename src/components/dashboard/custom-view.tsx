"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Server,
  Activity,
  BarChart3,
  Lock,
  Unlock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEnvironmentStore } from "@/stores/environment-store";
import {
  MetricsFilterBar,
  type TimeRange,
  type GroupBy,
} from "@/components/dashboard/metrics-filter-bar";
import { MetricChart } from "@/components/dashboard/metric-chart";
import { formatSI, formatBytesRate, formatEventsRate } from "@/lib/format";
import { derivePipelineStatus } from "@/lib/pipeline-status";
import { cn } from "@/lib/utils";
import type { PanelId } from "@/components/dashboard/view-builder-dialog";

import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
} from "react-grid-layout";
import type { LayoutItem, Layout } from "react-grid-layout";

const SUMMARY_PANELS: PanelId[] = [
  "node-health-summary",
  "pipeline-health-summary",
  "data-reduction",
];

/** Generate a default layout for panels when none is saved */
function generateDefaultLayout(panels: PanelId[]): LayoutItem[] {
  const layout: LayoutItem[] = [];
  const summaryPanels = panels.filter((p) => SUMMARY_PANELS.includes(p));
  const chartPanels = panels.filter((p) => !SUMMARY_PANELS.includes(p));

  // Summary panels: 1 row, each 4 cols wide (12/3)
  summaryPanels.forEach((p, i) => {
    layout.push({
      i: p,
      x: (i * 4) % 12,
      y: 0,
      w: 4,
      h: 2,
      minW: 3,
      minH: 2,
    });
  });

  const chartStartY = summaryPanels.length > 0 ? 2 : 0;
  // Chart panels: 2 columns, 6 cols wide each
  chartPanels.forEach((p, i) => {
    layout.push({
      i: p,
      x: (i % 2) * 6,
      y: chartStartY + Math.floor(i / 2) * 4,
      w: 6,
      h: 4,
      minW: 4,
      minH: 3,
    });
  });

  return layout;
}

interface DashboardViewData {
  id: string;
  name: string;
  panels: unknown; // Json field — string[] at runtime
  filters: unknown; // Json field — { pipelineIds?, nodeIds?, layout? }
}

interface CustomViewProps {
  view: DashboardViewData;
}

export function CustomView({ view }: CustomViewProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { selectedEnvironmentId } = useEnvironmentStore();
  const { width, containerRef, mounted } = useContainerWidth();

  // Parse view data
  const panels = useMemo(() => (view.panels ?? []) as PanelId[], [view.panels]);
  const savedFilters = (view.filters ?? {}) as {
    pipelineIds?: string[];
    nodeIds?: string[];
    layout?: LayoutItem[];
  };

  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>(
    savedFilters.nodeIds ?? []
  );
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>(
    savedFilters.pipelineIds ?? []
  );
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");
  const [groupBy, setGroupBy] = useState<GroupBy>("pipeline");
  const [layoutLocked, setLayoutLocked] = useState(true);

  // Layout state — use saved layout or generate a default
  const defaultLayout = useMemo(
    () => generateDefaultLayout(panels),
    [panels]
  );
  const [currentLayout, setCurrentLayout] = useState<LayoutItem[]>(
    savedFilters.layout ?? defaultLayout
  );

  // Refs for latest filter values so the debounce timer never captures stale state
  const filtersRef = useRef({ pipelineIds: selectedPipelineIds, nodeIds: selectedNodeIds });
  useEffect(() => {
    filtersRef.current = { pipelineIds: selectedPipelineIds, nodeIds: selectedNodeIds };
  }, [selectedPipelineIds, selectedNodeIds]);

  // Debounce layout save to avoid excessive mutations
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear pending timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const updateMutation = useMutation(
    trpc.dashboard.updateView.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [["dashboard", "listViews"]],
        });
      },
    })
  );

  const persistLayout = useCallback(
    (layout: Layout) => {
      if (!selectedEnvironmentId) return;
      const cleanLayout = layout.map(({ i, x, y, w, h }) => ({
        i,
        x,
        y,
        w,
        h,
      }));
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        const { pipelineIds, nodeIds } = filtersRef.current;
        updateMutation.mutate({
          environmentId: selectedEnvironmentId,
          id: view.id,
          filters: {
            pipelineIds,
            nodeIds,
            layout: cleanLayout,
          },
        });
      }, 800);
    },
    [selectedEnvironmentId, view.id, updateMutation]
  );

  const handleLayoutChange = useCallback(
    (layout: Layout) => {
      setCurrentLayout([...layout]);
      if (!layoutLocked) {
        persistLayout(layout);
      }
    },
    [layoutLocked, persistLayout]
  );

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

  const showFilterBar = needsChartData;

  /** Render a single panel by its ID */
  function renderPanel(panelId: PanelId) {
    switch (panelId) {
      case "node-health-summary":
        return (
          <Card className="h-full">
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
        );

      case "pipeline-health-summary":
        return (
          <Card className="h-full">
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
        );

      case "data-reduction":
        return (
          <Card className="h-full">
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
                      "mt-1 text-2xl font-bold tabular-nums",
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
        );

      case "events-in-out":
        return (
          <MetricChart
            title="Events In/Out per Second"
            data={chartData.data?.pipeline.eventsIn ?? {}}
            dataSecondary={chartData.data?.pipeline.eventsOut ?? {}}
            primaryLabel=" In"
            secondaryLabel=" Out"
            yFormatter={formatSI}
            timeRange={timeRange}
            height="100%"
          />
        );

      case "bytes-in-out":
        return (
          <MetricChart
            title="Bytes In/Out per Second"
            data={chartData.data?.pipeline.bytesIn ?? {}}
            dataSecondary={chartData.data?.pipeline.bytesOut ?? {}}
            primaryLabel=" In"
            secondaryLabel=" Out"
            yFormatter={(v) => formatBytesRate(v)}
            timeRange={timeRange}
            height="100%"
          />
        );

      case "error-rate":
        return (
          <MetricChart
            title="Errors & Discarded"
            data={chartData.data?.pipeline.errors ?? {}}
            dataSecondary={chartData.data?.pipeline.discarded ?? {}}
            variant="area"
            primaryLabel=" Errors"
            secondaryLabel=" Discarded"
            yFormatter={formatSI}
            timeRange={timeRange}
            height="100%"
          />
        );

      case "cpu-usage":
        return (
          <MetricChart
            title="CPU Usage"
            icon={<Cpu className="h-4 w-4" />}
            data={chartData.data?.system.cpu ?? {}}
            yFormatter={(v) => `${v.toFixed(0)}%`}
            yDomain={[0, 100]}
            timeRange={timeRange}
            height="100%"
          />
        );

      case "memory-usage":
        return (
          <MetricChart
            title="Memory Usage"
            icon={<MemoryStick className="h-4 w-4" />}
            data={chartData.data?.system.memory ?? {}}
            yFormatter={(v) => `${v.toFixed(0)}%`}
            yDomain={[0, 100]}
            timeRange={timeRange}
            height="100%"
          />
        );

      case "disk-io":
        return (
          <MetricChart
            title="Disk I/O"
            icon={<HardDrive className="h-4 w-4" />}
            data={chartData.data?.system.diskRead ?? {}}
            dataSecondary={chartData.data?.system.diskWrite ?? {}}
            primaryLabel=" Read"
            secondaryLabel=" Write"
            yFormatter={(v) => formatBytesRate(v)}
            timeRange={timeRange}
            height="100%"
          />
        );

      case "network-io":
        return (
          <MetricChart
            title="Network I/O"
            icon={<Network className="h-4 w-4" />}
            data={chartData.data?.system.netRx ?? {}}
            dataSecondary={chartData.data?.system.netTx ?? {}}
            primaryLabel=" Rx"
            secondaryLabel=" Tx"
            yFormatter={(v) => formatBytesRate(v)}
            timeRange={timeRange}
            height="100%"
          />
        );

      default:
        return null;
    }
  }

  return (
    <div className="space-y-4">
      {/* Toolbar: filter bar + layout lock toggle */}
      <div className="flex items-center justify-between gap-4">
        {showFilterBar ? (
          <div className="flex-1">
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
          </div>
        ) : (
          <div />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={layoutLocked ? "outline" : "secondary"}
              size="sm"
              onClick={() => setLayoutLocked((prev) => !prev)}
              className="shrink-0 gap-1.5"
            >
              {layoutLocked ? (
                <>
                  <Lock className="h-3.5 w-3.5" />
                  Layout Locked
                </>
              ) : (
                <>
                  <Unlock className="h-3.5 w-3.5" />
                  Editing Layout
                </>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {layoutLocked
              ? "Unlock to drag, resize, and rearrange panels"
              : "Lock layout to prevent accidental changes"}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Grid layout */}
      <div ref={containerRef}>
        {mounted && (
          <ResponsiveGridLayout
            width={width}
            layouts={{ lg: currentLayout }}
            breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
            cols={{ lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 }}
            rowHeight={60}
            dragConfig={{
              enabled: !layoutLocked,
              handle: ".react-grid-drag-handle",
            }}
            resizeConfig={{ enabled: !layoutLocked }}
            compactor={verticalCompactor}
            onLayoutChange={handleLayoutChange}
            containerPadding={[0, 0]}
            margin={[16, 16]}
          >
            {panels.map((panelId) => (
              <div
                key={panelId}
                className={cn(
                  "overflow-hidden rounded-lg",
                  !layoutLocked &&
                    "ring-2 ring-dashed ring-primary/20 react-grid-drag-handle cursor-grab"
                )}
              >
                {renderPanel(panelId)}
              </div>
            ))}
          </ResponsiveGridLayout>
        )}
      </div>
    </div>
  );
}
