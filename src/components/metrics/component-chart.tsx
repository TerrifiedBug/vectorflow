"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface MetricRow {
  timestamp: Date;
  eventsIn: bigint;
  eventsOut: bigint;
  bytesIn: bigint;
  bytesOut: bigint;
  errorsTotal: bigint;
}

interface MetricsChartProps {
  rows: MetricRow[];
  dataKey: "events" | "bytes";
  height?: number;
}

function formatEventsRate(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M/s`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K/s`;
  return `${v.toFixed(1)}/s`;
}

function formatBytesRate(v: number): string {
  if (v >= 1_073_741_824) return `${(v / 1_073_741_824).toFixed(1)} GB/s`;
  if (v >= 1_048_576) return `${(v / 1_048_576).toFixed(1)} MB/s`;
  if (v >= 1_024) return `${(v / 1_024).toFixed(1)} KB/s`;
  return `${v.toFixed(0)} B/s`;
}

export function MetricsChart({ rows, dataKey, height = 200 }: MetricsChartProps) {
  const data = rows.map((m) => ({
    time: new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    in: dataKey === "events" ? Number(m.eventsIn) / 60 : Number(m.bytesIn) / 60,
    out: dataKey === "events" ? Number(m.eventsOut) / 60 : Number(m.bytesOut) / 60,
  }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        No data yet
      </div>
    );
  }

  const formatter = dataKey === "events" ? formatEventsRate : formatBytesRate;
  const inLabel = dataKey === "events" ? "Events In/s" : "Bytes In/s";
  const outLabel = dataKey === "events" ? "Events Out/s" : "Bytes Out/s";
  const inColor = dataKey === "events" ? "#22c55e" : "#f59e0b";
  const outColor = dataKey === "events" ? "#3b82f6" : "#8b5cf6";

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis
          tick={{ fontSize: 10 }}
          width={55}
          tickFormatter={(v) => formatter(v)}
        />
        <Tooltip
          contentStyle={{ fontSize: 12 }}
          formatter={((v: number | undefined, name: string) => [formatter(v ?? 0), name]) as any}
        />
        <Area type="monotone" dataKey="in" name={inLabel} stroke={inColor} fill={inColor} fillOpacity={0.1} strokeWidth={1.5} />
        <Area type="monotone" dataKey="out" name={outLabel} stroke={outColor} fill={outColor} fillOpacity={0.1} strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
