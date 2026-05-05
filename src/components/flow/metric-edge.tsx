"use client";
import { memo, useMemo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

type EdgeKind = "source" | "transform" | "sink";

interface MetricEdgeData {
  throughput?: number;
  /** Source/target node kinds — drives the gradient stops */
  sourceKind?: EdgeKind;
  targetKind?: EdgeKind;
  /** When false, suppress flow markers regardless of throughput */
  running?: boolean;
}

const COLOR_VAR: Record<EdgeKind, string> = {
  source: "var(--node-source)",
  transform: "var(--node-transform)",
  sink: "var(--node-sink)",
};

/**
 * Pick a desync'd duration in [2.4s, 3.4s] keyed off the edge id so each edge
 * pulses at its own cadence but the cadence is stable across renders.
 */
function durationFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const slot = Math.abs(h) % 11; // 0..10 → 11 buckets
  return 2.4 + slot * 0.1;
}

function MetricEdgeComponent({ id, data, selected, ...props }: EdgeProps) {
  const [edgePath] = getBezierPath(props);
  const d = (data ?? {}) as MetricEdgeData;
  const throughput = d.throughput;
  const sourceKind: EdgeKind = d.sourceKind ?? "source";
  const targetKind: EdgeKind = d.targetKind ?? "transform";
  // Default `running` to "yes if throughput > 0" so existing pipelines that
  // don't yet plumb a status flag still animate when traffic is flowing.
  const running = d.running ?? (throughput !== undefined && throughput > 0);
  const gradId = `metric-edge-grad-${id}`;
  const dur = useMemo(() => durationFor(id), [id]);

  const startColor = COLOR_VAR[sourceKind];
  const endColor = COLOR_VAR[targetKind];

  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={startColor} stopOpacity="0.55" />
          <stop offset="100%" stopColor={endColor} stopOpacity="0.95" />
        </linearGradient>
      </defs>
      {/* Wide invisible hit-area for click/hover */}
      <BaseEdge
        path={edgePath}
        {...props}
        style={{ stroke: "transparent", strokeWidth: 20 }}
      />
      {/* Gradient stroke */}
      <path
        d={edgePath}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={selected ? 2 : 1.5}
        opacity={0.9}
      />
      {/* Animated flow marker — only while running */}
      {running && (
        <circle r={2.5} fill={endColor}>
          <animateMotion
            dur={`${dur}s`}
            repeatCount="indefinite"
            path={edgePath}
          />
        </circle>
      )}
    </>
  );
}

export const MetricEdge = memo(MetricEdgeComponent);
