"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Cpu, MemoryStick, HardDrive, Network } from "lucide-react";
import { useState } from "react";
import { formatBytes, formatBytesRate, formatPercent, formatTime } from "@/lib/format";

interface NodeMetricsChartsProps {
  nodeId: string;
}

const CHART_HEIGHT = 180;

const cpuChartConfig = {
  cpuPercent: { label: "CPU", color: "#3b82f6" },
} satisfies ChartConfig;

const memoryChartConfig = {
  memPercent: { label: "Memory", color: "#22c55e" },
} satisfies ChartConfig;

const diskChartConfig = {
  diskReadRate: { label: "Read", color: "#f59e0b" },
  diskWriteRate: { label: "Write", color: "#ef4444" },
} satisfies ChartConfig;

const networkChartConfig = {
  netRxRate: { label: "Receive", color: "#8b5cf6" },
  netTxRate: { label: "Transmit", color: "#06b6d4" },
} satisfies ChartConfig;

export function NodeMetricsCharts({ nodeId }: NodeMetricsChartsProps) {
  const trpc = useTRPC();
  const [hours, setHours] = useState(1);

  const metricsQuery = useQuery({
    ...trpc.fleet.nodeMetrics.queryOptions({ nodeId, hours }),
    refetchInterval: 15_000,
  });

  const raw = metricsQuery.data ?? [];

  if (metricsQuery.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-lg" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (raw.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
        <p className="text-muted-foreground">No system metrics yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Metrics appear after the agent starts reporting heartbeats with host data.
        </p>
      </div>
    );
  }

  // Compute derived metrics: CPU%, memory%, disk I/O rates, network rates
  const data = raw.map((m, i) => {
    const memTotal = Number(m.memoryTotalBytes);
    const memUsed = Number(m.memoryUsedBytes);
    const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

    const fsTotal = Number(m.fsTotalBytes);
    const fsUsed = Number(m.fsUsedBytes);
    const fsPercent = fsTotal > 0 ? (fsUsed / fsTotal) * 100 : 0;

    // CPU% = (busy time / total time) across all cores
    let cpuPercent = 0;
    if (i > 0) {
      const prev = raw[i - 1];
      const totalDelta = m.cpuSecondsTotal - prev.cpuSecondsTotal;
      const idleDelta = m.cpuSecondsIdle - prev.cpuSecondsIdle;
      if (totalDelta > 0) {
        cpuPercent = ((totalDelta - idleDelta) / totalDelta) * 100;
        if (cpuPercent < 0) cpuPercent = 0;
        if (cpuPercent > 100) cpuPercent = 100;
      }
    }

    // Disk I/O rates (bytes/sec delta)
    let diskReadRate = 0;
    let diskWriteRate = 0;
    if (i > 0) {
      const prev = raw[i - 1];
      const dtSeconds =
        (new Date(m.timestamp).getTime() -
          new Date(prev.timestamp).getTime()) /
        1000;
      if (dtSeconds > 0) {
        diskReadRate =
          (Number(m.diskReadBytes) - Number(prev.diskReadBytes)) / dtSeconds;
        diskWriteRate =
          (Number(m.diskWrittenBytes) - Number(prev.diskWrittenBytes)) /
          dtSeconds;
        if (diskReadRate < 0) diskReadRate = 0;
        if (diskWriteRate < 0) diskWriteRate = 0;
      }
    }

    // Network I/O rates (bytes/sec delta)
    let netRxRate = 0;
    let netTxRate = 0;
    if (i > 0) {
      const prev = raw[i - 1];
      const dtSeconds =
        (new Date(m.timestamp).getTime() -
          new Date(prev.timestamp).getTime()) /
        1000;
      if (dtSeconds > 0) {
        netRxRate =
          (Number(m.netRxBytes) - Number(prev.netRxBytes)) / dtSeconds;
        netTxRate =
          (Number(m.netTxBytes) - Number(prev.netTxBytes)) / dtSeconds;
        if (netRxRate < 0) netRxRate = 0;
        if (netTxRate < 0) netTxRate = 0;
      }
    }

    return {
      time: formatTime(m.timestamp),
      cpuPercent,
      memPercent,
      memUsed,
      memTotal,
      fsPercent,
      fsUsed,
      fsTotal,
      loadAvg1: m.loadAvg1,
      loadAvg5: m.loadAvg5,
      loadAvg15: m.loadAvg15,
      diskReadRate,
      diskWriteRate,
      netRxRate,
      netTxRate,
    };
  });

  // Remove the first data point since deltas are zero
  const chartData = data.slice(1);

  // Summary stats from the latest data point
  const latest = data[data.length - 1];

  return (
    <div className="space-y-4">
      {/* Summary bar + time range selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>
            CPU: <span className="font-mono tabular-nums text-foreground">{formatPercent(latest.cpuPercent)}</span>
          </span>
          <span>
            Memory: <span className="font-mono tabular-nums text-foreground">{formatBytes(latest.memUsed)}</span>
            <span className="text-xs"> / {formatBytes(latest.memTotal)}</span>
          </span>
          <span>
            Disk: <span className="font-mono tabular-nums text-foreground">{formatPercent(latest.fsPercent)}</span>
          </span>
          <span>
            Load: <span className="font-mono tabular-nums text-foreground">{latest.loadAvg1.toFixed(2)}</span>
          </span>
        </div>
        <Select
          value={String(hours)}
          onValueChange={(v) => setHours(Number(v))}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">1 hour</SelectItem>
            <SelectItem value="6">6 hours</SelectItem>
            <SelectItem value="24">24 hours</SelectItem>
            <SelectItem value="168">7 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Charts grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* CPU Usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Cpu className="h-4 w-4" />
              CPU Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={cpuChartConfig} className="w-full" style={{ height: CHART_HEIGHT }}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={40}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-muted-foreground">{cpuChartConfig[name as keyof typeof cpuChartConfig]?.label ?? name}</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">{formatPercent(Number(value) ?? 0)}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="cpuPercent"
                  stroke="var(--color-cpuPercent)"
                  fill="var(--color-cpuPercent)"
                  fillOpacity={0.2}
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Memory Usage */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <MemoryStick className="h-4 w-4" />
              Memory Usage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={memoryChartConfig} className="w-full" style={{ height: CHART_HEIGHT }}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={40}
                  domain={[0, 100]}
                  tickFormatter={(v) => `${v}%`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-muted-foreground">{memoryChartConfig[name as keyof typeof memoryChartConfig]?.label ?? name}</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">{formatPercent(Number(value) ?? 0)}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="memPercent"
                  stroke="var(--color-memPercent)"
                  fill="var(--color-memPercent)"
                  fillOpacity={0.2}
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Disk I/O */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <HardDrive className="h-4 w-4" />
              Disk I/O
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={diskChartConfig} className="w-full" style={{ height: CHART_HEIGHT }}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={55}
                  tickFormatter={(v) => formatBytesRate(v)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-muted-foreground">{diskChartConfig[name as keyof typeof diskChartConfig]?.label ?? name}</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">{formatBytesRate(Number(value) ?? 0)}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="diskReadRate"
                  stroke="var(--color-diskReadRate)"
                  fill="var(--color-diskReadRate)"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="diskWriteRate"
                  stroke="var(--color-diskWriteRate)"
                  fill="var(--color-diskWriteRate)"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Network I/O */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Network className="h-4 w-4" />
              Network I/O
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={networkChartConfig} className="w-full" style={{ height: CHART_HEIGHT }}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={55}
                  tickFormatter={(v) => formatBytesRate(v)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-muted-foreground">{networkChartConfig[name as keyof typeof networkChartConfig]?.label ?? name}</span>
                          <span className="font-mono font-medium tabular-nums text-foreground">{formatBytesRate(Number(value) ?? 0)}</span>
                        </div>
                      )}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="netRxRate"
                  stroke="var(--color-netRxRate)"
                  fill="var(--color-netRxRate)"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="netTxRate"
                  stroke="var(--color-netTxRate)"
                  fill="var(--color-netTxRate)"
                  fillOpacity={0.15}
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
