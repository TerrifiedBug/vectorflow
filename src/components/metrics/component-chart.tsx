"use client";

import { useMemo } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Inbox } from "lucide-react";
import { formatBytesRate, formatLatency } from "@/lib/format";

interface MetricRow {
  timestamp: Date;
  eventsIn: bigint;
  eventsOut: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  errorsTotal: bigint;
  eventsDiscarded: bigint;
  latencyMeanMs?: number | null;
}

interface MetricsChartProps {
  rows: MetricRow[];
  dataKey: "events" | "bytes" | "errors" | "latency";
  height?: number;
}

function formatEventsRate(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M/s`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K/s`;
  return `${v.toFixed(1)}/s`;
}

const colorMap = {
  events: { in: "#22c55e", out: "#3b82f6" },
  bytes: { in: "#f59e0b", out: "#8b5cf6" },
  errors: { in: "#ef4444", out: "#f97316" },
  latency: { in: "#ec4899", out: "#ec4899" },
} as const;

const labelMap = {
  events: { in: "Events In/s", out: "Events Out/s" },
  bytes: { in: "Bytes In/s", out: "Bytes Out/s" },
  errors: { in: "Errors/s", out: "Discarded/s" },
  latency: { in: "Mean Latency", out: "Mean Latency" },
} as const;

export function MetricsChart({ rows, dataKey, height = 200 }: MetricsChartProps) {
  const data = rows.map((m) => ({
    time: new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    in: dataKey === "events" ? Number(m.eventsIn) / 60
      : dataKey === "bytes" ? Number(m.bytesIn) / 60
      : dataKey === "latency" ? (m.latencyMeanMs ?? 0)
      : Number(m.errorsTotal) / 60,
    out: dataKey === "events" ? Number(m.eventsOut) / 60
      : dataKey === "bytes" ? Number(m.bytesOut) / 60
      : dataKey === "latency" ? (m.latencyMeanMs ?? 0)
      : Number(m.eventsDiscarded) / 60,
  }));

  const chartConfig = useMemo<ChartConfig>(() => ({
    in: { label: labelMap[dataKey].in, color: colorMap[dataKey].in },
    out: { label: labelMap[dataKey].out, color: colorMap[dataKey].out },
  }), [dataKey]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-muted-foreground" style={{ height }}>
        <Inbox className="h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm">No data yet</p>
      </div>
    );
  }

  const formatter = dataKey === "bytes" ? formatBytesRate : dataKey === "latency" ? formatLatency : formatEventsRate;

  return (
    <ChartContainer config={chartConfig} className="w-full" style={{ height }}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis
          tick={{ fontSize: 10 }}
          width={55}
          tickFormatter={(v) => formatter(v)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-muted-foreground">{chartConfig[name as keyof typeof chartConfig]?.label ?? name}</span>
                  <span className="font-mono font-medium tabular-nums text-foreground">{formatter(Number(value) ?? 0)}</span>
                </div>
              )}
            />
          }
        />
        <Area type="monotone" dataKey="in" name={labelMap[dataKey].in} stroke="var(--color-in)" fill="var(--color-in)" fillOpacity={0.1} strokeWidth={1.5} />
        {dataKey !== "latency" && (
          <Area type="monotone" dataKey="out" name={labelMap[dataKey].out} stroke="var(--color-out)" fill="var(--color-out)" fillOpacity={0.1} strokeWidth={1.5} />
        )}
      </AreaChart>
    </ChartContainer>
  );
}
