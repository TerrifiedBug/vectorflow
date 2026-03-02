"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatBytesRate } from "@/lib/format";

interface PipelineMetricsChartProps {
  pipelineId: string;
  hours?: number;
}

function formatEventsRate(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M/s`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K/s`;
  return `${v.toFixed(1)}/s`;
}

export function PipelineMetricsChart({ pipelineId, hours = 24 }: PipelineMetricsChartProps) {
  const trpc = useTRPC();

  const metricsQuery = useQuery({
    ...trpc.pipeline.metrics.queryOptions({ pipelineId, hours }),
    refetchInterval: 60_000,
  });

  // Convert minute-bucket deltas to per-second rates
  const data = (metricsQuery.data ?? []).map((m) => ({
    time: new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    "Events In/s": Number(m.eventsIn) / 60,
    "Events Out/s": Number(m.eventsOut) / 60,
    "Bytes In/s": Number(m.bytesIn) / 60,
    "Bytes Out/s": Number(m.bytesOut) / 60,
    Errors: Number(m.errorsTotal),
  }));

  if (metricsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
        Loading metrics...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-xs text-muted-foreground">
        No metrics data yet. Metrics appear after agents report heartbeats.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Events rate chart */}
      <div>
        <p className="text-xs text-muted-foreground mb-1 font-medium">Events Throughput</p>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fontSize: 10 }}
              width={55}
              tickFormatter={(v) => formatEventsRate(v)}
            />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={((v: number | undefined, name: string) => [formatEventsRate(v ?? 0), name]) as any}
            />
            <Area
              type="monotone"
              dataKey="Events In/s"
              stroke="#22c55e"
              fill="#22c55e"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
            <Area
              type="monotone"
              dataKey="Events Out/s"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Bytes rate chart */}
      <div>
        <p className="text-xs text-muted-foreground mb-1 font-medium">Data Throughput</p>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis
              tick={{ fontSize: 10 }}
              width={55}
              tickFormatter={(v) => formatBytesRate(v)}
            />
            <Tooltip
              contentStyle={{ fontSize: 12 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={((v: number | undefined, name: string) => [formatBytesRate(v ?? 0), name]) as any}
            />
            <Area
              type="monotone"
              dataKey="Bytes In/s"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
            <Area
              type="monotone"
              dataKey="Bytes Out/s"
              stroke="#8b5cf6"
              fill="#8b5cf6"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
