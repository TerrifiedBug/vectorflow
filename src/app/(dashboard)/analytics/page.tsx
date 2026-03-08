"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { ArrowUp, ArrowDown, Minus, BarChart3, Info } from "lucide-react";
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
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { useEnvironmentStore } from "@/stores/environment-store";
import { formatBytes, formatTimeAxis } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

type VolumeRange = "1h" | "6h" | "1d" | "7d" | "30d";


/** Compute percentage change between previous and current values */
function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return ((current - previous) / previous) * 100;
}

interface PipelineRow {
  pipelineId: string;
  pipelineName: string;
  bytesIn: number;
  bytesOut: number;
  eventsIn: number;
  eventsOut: number;
  reduction: number;
  eventsReduced: number;
}

type SortKey = "pipelineName" | "bytesIn" | "bytesOut" | "reduction" | "eventsReduced";
type SortDir = "asc" | "desc";

export default function AnalyticsPage() {
  const trpc = useTRPC();
  const { selectedEnvironmentId } = useEnvironmentStore();
  const [range, setRange] = useState<VolumeRange>("1d");
  const [sortKey, setSortKey] = useState<SortKey>("bytesIn");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const analytics = useQuery({
    ...trpc.dashboard.volumeAnalytics.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: range === "1h" ? 15_000 : range === "6h" ? 60_000 : 120_000,
  });

  const data = analytics.data;

  // Compute KPIs
  const totalBytesIn = Number(data?.current._sum.bytesIn ?? 0);
  const totalBytesOut = Number(data?.current._sum.bytesOut ?? 0);
  const prevBytesIn = Number(data?.previous._sum.bytesIn ?? 0);
  const prevBytesOut = Number(data?.previous._sum.bytesOut ?? 0);
  const reductionPercent = totalBytesIn > 0 ? (1 - totalBytesOut / totalBytesIn) * 100 : null;
  const prevReductionPercent = prevBytesIn > 0 ? (1 - prevBytesOut / prevBytesIn) * 100 : null;
  const reductionDelta =
    reductionPercent != null && prevReductionPercent != null
      ? reductionPercent - prevReductionPercent
      : null;

  // Event-based reduction (matches pipelines table formula, clamped at 0%)
  const totalEventsIn = Number(data?.current._sum.eventsIn ?? 0);
  const totalEventsOut = Number(data?.current._sum.eventsOut ?? 0);
  const eventsReducedPercent = totalEventsIn > 0 ? Math.max(0, (1 - totalEventsOut / totalEventsIn) * 100) : null;

  const prevEventsIn = Number(data?.previous._sum.eventsIn ?? 0);
  const prevEventsOut = Number(data?.previous._sum.eventsOut ?? 0);
  const prevEventsReducedPercent = prevEventsIn > 0 ? Math.max(0, (1 - prevEventsOut / prevEventsIn) * 100) : null;
  const eventsReducedDelta =
    eventsReducedPercent != null && prevEventsReducedPercent != null
      ? eventsReducedPercent - prevEventsReducedPercent
      : null;

  // Rename bytes vars for clarity
  const bytesSavedPercent = reductionPercent;
  const bytesSavedDelta = reductionDelta;

  const bytesInTrend = trendPercent(totalBytesIn, prevBytesIn);
  const bytesOutTrend = trendPercent(totalBytesOut, prevBytesOut);

  // Chart data
  const chartData = data?.timeSeries
    ? data.timeSeries.map((ts) => ({
        t: new Date(ts.bucket).getTime(),
        bytesIn: ts.bytesIn,
        bytesOut: ts.bytesOut,
      }))
    : [];

  const chartConfig: ChartConfig = {
    bytesIn: { label: "Bytes In", color: "oklch(0.55 0.24 265)" },
    bytesOut: { label: "Bytes Out", color: "oklch(0.65 0.17 163)" },
  };

  // Per-pipeline table with sorting
  const sortedPipelines = (() => {
    if (!data?.perPipeline) return [];
    const rows: PipelineRow[] = data.perPipeline.map((p: Omit<PipelineRow, "reduction" | "eventsReduced">) => ({
      ...p,
      reduction: p.bytesIn > 0 ? (1 - p.bytesOut / p.bytesIn) * 100 : 0,
      eventsReduced: p.eventsIn > 0 ? Math.max(0, (1 - p.eventsOut / p.eventsIn) * 100) : 0,
    }));
    return rows.sort((a: PipelineRow, b: PipelineRow) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  })();

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? " \u2191" : " \u2193";
  };

  if (!selectedEnvironmentId) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">
            Select an environment to view analytics.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with time range selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Data Volume Analytics</h2>
        </div>
        <div className="flex items-center gap-1">
          {(["1h", "6h", "1d", "7d", "30d"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setRange(v)}
              className={cn(
                "rounded-full px-3 h-7 text-xs font-medium border transition-colors",
                range === v
                  ? "bg-accent text-accent-foreground border-transparent"
                  : "bg-transparent text-muted-foreground border-border hover:bg-muted",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        {/* Total In */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total In</p>
              <TrendArrow value={bytesInTrend} />
            </div>
            <p className="mt-1 text-2xl font-bold">
              {data ? formatBytes(totalBytesIn) : "--"}
            </p>
            {bytesInTrend != null && (
              <p className="text-xs text-muted-foreground">
                {bytesInTrend >= 0 ? "+" : ""}
                {bytesInTrend.toFixed(1)}% vs previous period
              </p>
            )}
          </CardContent>
        </Card>

        {/* Total Out */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total Out</p>
              <TrendArrow value={bytesOutTrend} />
            </div>
            <p className="mt-1 text-2xl font-bold">
              {data ? formatBytes(totalBytesOut) : "--"}
            </p>
            {bytesOutTrend != null && (
              <p className="text-xs text-muted-foreground">
                {bytesOutTrend >= 0 ? "+" : ""}
                {bytesOutTrend.toFixed(1)}% vs previous period
              </p>
            )}
          </CardContent>
        </Card>

        {/* Events Reduced */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Events Reduced</p>
              <TrendArrow value={eventsReducedDelta} invertColor />
            </div>
            <p
              className={cn(
                "mt-1 text-2xl font-bold",
                eventsReducedPercent != null && eventsReducedPercent > 50
                  ? "text-green-600 dark:text-green-400"
                  : eventsReducedPercent != null && eventsReducedPercent > 10
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-muted-foreground",
              )}
            >
              {eventsReducedPercent != null ? `${eventsReducedPercent.toFixed(1)}%` : "--"}
            </p>
            {eventsReducedDelta != null && (
              <p className="text-xs text-muted-foreground">
                {eventsReducedDelta >= 0 ? "+" : ""}
                {eventsReducedDelta.toFixed(1)} pp vs last period
              </p>
            )}
          </CardContent>
        </Card>

        {/* Bytes Saved */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <p className="text-sm font-medium text-muted-foreground">Bytes Saved</p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Total bytes saved including sink compression and encoding
                  </TooltipContent>
                </Tooltip>
              </div>
              <TrendArrow value={bytesSavedDelta} invertColor />
            </div>
            <p className="mt-1 text-2xl font-bold text-muted-foreground">
              {bytesSavedPercent != null ? `${bytesSavedPercent.toFixed(1)}%` : "--"}
            </p>
            {bytesSavedDelta != null && (
              <p className="text-xs text-muted-foreground">
                {bytesSavedDelta >= 0 ? "+" : ""}
                {bytesSavedDelta.toFixed(1)} pp vs last period
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Volume Over Time Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            Volume Over Time
          </CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div
              className="flex items-center justify-center text-xs text-muted-foreground"
              style={{ height: 300 }}
            >
              No data for selected time range
            </div>
          ) : (
            <ChartContainer config={chartConfig} className="w-full" style={{ height: 300 }}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted/30" />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => formatTimeAxis(v, range)}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  width={65}
                  tickFormatter={formatBytes}
                  domain={["auto", "auto"]}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_value: string, payload: Array<{ payload?: { t?: number } }>) => {
                        const timestamp = payload?.[0]?.payload?.t;
                        if (!timestamp) return "";
                        return new Date(Number(timestamp)).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        });
                      }}
                      formatter={(value, name) => (
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-muted-foreground">
                            {chartConfig[name as string]?.label ?? name}
                          </span>
                          <span className="font-mono font-medium tabular-nums text-foreground">
                            {formatBytes(value as number)}
                          </span>
                        </div>
                      )}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="bytesIn"
                  stroke="var(--color-bytesIn)"
                  fill="var(--color-bytesIn)"
                  fillOpacity={0.2}
                  strokeWidth={1.5}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="bytesOut"
                  stroke="var(--color-bytesOut)"
                  fill="var(--color-bytesOut)"
                  fillOpacity={0.2}
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-Pipeline Breakdown Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Per-Pipeline Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedPipelines.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
              No pipeline data for selected time range
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort("pipelineName")}
                  >
                    Pipeline Name{sortIndicator("pipelineName")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("bytesIn")}
                  >
                    Bytes In{sortIndicator("bytesIn")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("bytesOut")}
                  >
                    Bytes Out{sortIndicator("bytesOut")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("eventsReduced")}
                  >
                    Events Reduced{sortIndicator("eventsReduced")}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort("reduction")}
                  >
                    Bytes Saved{sortIndicator("reduction")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPipelines.map((p: PipelineRow) => (
                  <TableRow key={p.pipelineId}>
                    <TableCell className="font-medium">{p.pipelineName}</TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBytes(p.bytesIn)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatBytes(p.bytesOut)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              p.eventsReduced > 50
                                ? "bg-green-500"
                                : p.eventsReduced > 10
                                  ? "bg-amber-500"
                                  : "bg-muted-foreground/30",
                            )}
                            style={{ width: `${Math.max(0, Math.min(100, p.eventsReduced))}%` }}
                          />
                        </div>
                        <span className="font-mono text-sm w-14 text-right">
                          {p.eventsReduced.toFixed(1)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-2 w-16 rounded-full bg-muted overflow-hidden">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all",
                              p.reduction >= 50
                                ? "bg-green-500"
                                : p.reduction >= 20
                                  ? "bg-amber-500"
                                  : "bg-red-400",
                            )}
                            style={{ width: `${Math.max(0, Math.min(100, p.reduction))}%` }}
                          />
                        </div>
                        <span className="font-mono text-sm w-14 text-right">
                          {p.reduction.toFixed(1)}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Small trend arrow indicator */
function TrendArrow({
  value,
  invertColor = false,
}: {
  value: number | null;
  invertColor?: boolean;
}) {
  if (value == null) return <Minus className="h-4 w-4 text-muted-foreground" />;
  const isUp = value > 0;
  // For reduction, higher is better, so green = up
  // For bytes in/out, default: up = red, down = green — invertColor flips
  const greenWhenUp = invertColor;
  const isGreen = greenWhenUp ? isUp : !isUp;

  if (Math.abs(value) < 0.1) return <Minus className="h-4 w-4 text-muted-foreground" />;

  return isUp ? (
    <ArrowUp
      className={cn(
        "h-4 w-4",
        isGreen ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
      )}
    />
  ) : (
    <ArrowDown
      className={cn(
        "h-4 w-4",
        isGreen ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
      )}
    />
  );
}
