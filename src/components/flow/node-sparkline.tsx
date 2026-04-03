"use client";

import { memo } from "react";
import type { MetricSample } from "@/server/services/metric-store";

interface NodeSparklineProps {
  samples: MetricSample[];
  width?: number;
  height?: number;
}

function NodeSparklineComponent({ samples, width = 60, height = 20 }: NodeSparklineProps) {
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
        style={{ transition: "stroke 300ms ease" }}
      />
    </svg>
  );
}

export const NodeSparkline = memo(NodeSparklineComponent, (prev, next) => {
  if (prev.width !== next.width || prev.height !== next.height) return false;
  if (prev.samples.length !== next.samples.length) return false;
  const prevLast = prev.samples[prev.samples.length - 1];
  const nextLast = next.samples[next.samples.length - 1];
  return prevLast?.timestamp === nextLast?.timestamp;
});
