"use client";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

export function MetricEdge({ data, ...props }: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath(props);
  const throughput = data?.throughput as number | undefined;

  return (
    <>
      <BaseEdge path={edgePath} {...props} />
      {throughput !== undefined && (
        <foreignObject
          width={80}
          height={24}
          x={labelX - 40}
          y={labelY - 12}
        >
          <div className="flex items-center justify-center rounded bg-muted px-2 py-0.5 text-xs font-mono tabular-nums text-muted-foreground">
            {throughput > 1000
              ? `${(throughput / 1000).toFixed(1)}k/s`
              : `${throughput}/s`}
          </div>
        </foreignObject>
      )}
    </>
  );
}
