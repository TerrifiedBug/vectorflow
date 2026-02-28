"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { MetricSample } from "@/server/services/metric-store";

interface ComponentChartProps {
  samples: MetricSample[];
  height?: number;
}

export function ComponentChart({ samples, height = 120 }: ComponentChartProps) {
  const data = samples.map((s) => ({
    time: new Date(s.timestamp).toLocaleTimeString(),
    "Events In": Math.round(s.receivedEventsRate),
    "Events Out": Math.round(s.sentEventsRate),
  }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>
        No data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} width={40} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="Events In" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} strokeWidth={1.5} />
        <Area type="monotone" dataKey="Events Out" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.1} strokeWidth={1.5} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
