"use client";

import type { MetricSample } from "@/server/services/metric-store";

interface NodeSparklineProps {
  samples: MetricSample[];
  width?: number;
  height?: number;
}

export function NodeSparkline({ samples, width = 60, height = 20 }: NodeSparklineProps) {
  if (samples.length < 2) return null;

  const rates = samples.map((s) => s.sentEventsRate);
  const max = Math.max(...rates, 1);
  const min = Math.min(...rates, 0);
  const range = max - min || 1;

  const points = rates
    .map((r, i) => {
      const x = (i / (rates.length - 1)) * width;
      const y = height - ((r - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const latest = rates[rates.length - 1];
  const color = latest === 0 ? "#ef4444" : latest < 10 ? "#eab308" : "#22c55e";

  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
