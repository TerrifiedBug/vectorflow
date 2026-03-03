"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { useEnvironmentStore } from "@/stores/environment-store";
import {
  MetricsFilterBar,
  type TimeRange,
} from "@/components/dashboard/metrics-filter-bar";
import { MetricsSection } from "@/components/dashboard/metrics-section";
import { MetricChart } from "@/components/dashboard/metric-chart";
import { formatSI, formatBytesRate } from "@/lib/format";

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

export default function DashboardPage() {
  const trpc = useTRPC();

  const stats = useQuery(trpc.dashboard.stats.queryOptions());
  const pipelineCards = useQuery({
    ...trpc.dashboard.pipelineCards.queryOptions(),
    refetchInterval: 15_000,
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

  const { selectedEnvironmentId } = useEnvironmentStore();
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedPipelineIds, setSelectedPipelineIds] = useState<string[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>("1h");

  const refreshInterval: Record<TimeRange, number> = {
    "1h": 15_000,
    "6h": 60_000,
    "1d": 60_000,
    "7d": 300_000,
  };

  const chartData = useQuery({
    ...trpc.dashboard.chartMetrics.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      nodeIds: selectedNodeIds,
      pipelineIds: selectedPipelineIds,
      range: timeRange,
    }),
    refetchInterval: refreshInterval[timeRange],
    enabled: !!selectedEnvironmentId,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Operational overview of your VectorFlow platform
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/pipelines/new">New Pipeline</Link>
          </Button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Total Nodes */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total Nodes</p>
              <Server className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-1 text-2xl font-bold">{stats.data?.nodes ?? 0}</p>
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
            <p className="mt-1 text-2xl font-bold">{stats.data?.pipelines ?? 0}</p>
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
      </div>

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
    </div>
  );
}
