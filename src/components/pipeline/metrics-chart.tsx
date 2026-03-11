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
import { Skeleton } from "@/components/ui/skeleton";
import { Inbox } from "lucide-react";
import { formatBytesRate, formatLatency } from "@/lib/format";

interface PipelineMetricsChartProps {
  pipelineId: string;
  hours?: number;
}

function formatEventsRate(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M/s`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K/s`;
  return `${v.toFixed(1)}/s`;
}

const eventsChartConfig = {
  eventsIn: { label: "Events In/s", color: "#22c55e" },
  eventsOut: { label: "Events Out/s", color: "#3b82f6" },
} satisfies ChartConfig;

const bytesChartConfig = {
  bytesIn: { label: "Bytes In/s", color: "#f59e0b" },
  bytesOut: { label: "Bytes Out/s", color: "#8b5cf6" },
} satisfies ChartConfig;

const latencyChartConfig = {
  latency: { label: "Mean Latency", color: "#ec4899" },
} satisfies ChartConfig;

export function PipelineMetricsChart({ pipelineId, hours = 24 }: PipelineMetricsChartProps) {
  const trpc = useTRPC();

  const metricsQuery = useQuery({
    ...trpc.pipeline.metrics.queryOptions({ pipelineId, hours }),
    refetchInterval: 60_000,
  });

  // Convert minute-bucket deltas to per-second rates
  const data = (metricsQuery.data ?? []).map((m) => ({
    time: new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    eventsIn: Number(m.eventsIn) / 60,
    eventsOut: Number(m.eventsOut) / 60,
    bytesIn: Number(m.bytesIn) / 60,
    bytesOut: Number(m.bytesOut) / 60,
    errors: Number(m.errorsTotal),
    latency: m.latencyMeanMs ?? 0,
  }));

  if (metricsQuery.isLoading) {
    return <Skeleton className="h-48 w-full rounded-lg" />;
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
        <Inbox className="h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm">No metrics data yet</p>
        <p className="text-xs text-muted-foreground/70">Metrics appear after agents report heartbeats.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Events rate chart */}
      <div>
        <p className="text-xs text-muted-foreground mb-1 font-medium">Events Throughput</p>
        <ChartContainer config={eventsChartConfig} className="w-full" style={{ height: 180 }}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fontSize: 10 }}
              width={55}
              tickFormatter={(v) => formatEventsRate(v)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-muted-foreground">{eventsChartConfig[name as keyof typeof eventsChartConfig]?.label ?? name}</span>
                      <span className="font-mono font-medium text-foreground">{formatEventsRate(Number(value) ?? 0)}</span>
                    </div>
                  )}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="eventsIn"
              name="Events In/s"
              stroke="var(--color-eventsIn)"
              fill="var(--color-eventsIn)"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
            <Area
              type="monotone"
              dataKey="eventsOut"
              name="Events Out/s"
              stroke="var(--color-eventsOut)"
              fill="var(--color-eventsOut)"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ChartContainer>
      </div>

      {/* Bytes rate chart */}
      <div>
        <p className="text-xs text-muted-foreground mb-1 font-medium">Data Throughput</p>
        <ChartContainer config={bytesChartConfig} className="w-full" style={{ height: 180 }}>
          <AreaChart data={data}>
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
                      <span className="text-muted-foreground">{bytesChartConfig[name as keyof typeof bytesChartConfig]?.label ?? name}</span>
                      <span className="font-mono font-medium text-foreground">{formatBytesRate(Number(value) ?? 0)}</span>
                    </div>
                  )}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="bytesIn"
              name="Bytes In/s"
              stroke="var(--color-bytesIn)"
              fill="var(--color-bytesIn)"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
            <Area
              type="monotone"
              dataKey="bytesOut"
              name="Bytes Out/s"
              stroke="var(--color-bytesOut)"
              fill="var(--color-bytesOut)"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ChartContainer>
      </div>

      {/* Latency chart */}
      <div>
        <p className="text-xs text-muted-foreground mb-1 font-medium">Transform Latency</p>
        <ChartContainer config={latencyChartConfig} className="w-full" style={{ height: 180 }}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fontSize: 10 }}
              width={55}
              tickFormatter={(v) => formatLatency(v)}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name) => (
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="text-muted-foreground">{latencyChartConfig[name as keyof typeof latencyChartConfig]?.label ?? name}</span>
                      <span className="font-mono font-medium text-foreground">{formatLatency(Number(value) ?? 0)}</span>
                    </div>
                  )}
                />
              }
            />
            <Area
              type="monotone"
              dataKey="latency"
              name="Mean Latency"
              stroke="var(--color-latency)"
              fill="var(--color-latency)"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}
