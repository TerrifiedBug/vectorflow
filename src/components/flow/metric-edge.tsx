"use client";
import { memo } from "react";
import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

function MetricEdgeComponent({ data, ...props }: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath(props);
  const throughput = data?.throughput as number | undefined;
  const isActive = throughput !== undefined && throughput > 0;

  return (
    <>
      {/* Invisible wide path for click/hover hit area — React Flow needs this for interaction */}
      <BaseEdge path={edgePath} {...props} style={{ stroke: "transparent", strokeWidth: 20 }} />
      {/* Visible animated path */}
      <path
        d={edgePath}
        fill="none"
        className={cn(
          "stroke-border",
          isActive && "stroke-foreground/60"
        )}
        strokeWidth={isActive ? 2.5 : 2}
        strokeDasharray={isActive ? "8 4" : undefined}
        style={isActive ? { animation: "flow-dash 1.2s linear infinite" } : undefined}
        markerEnd={props.markerEnd}
      />
      {/* Throughput label at edge midpoint */}
      {throughput !== undefined && (
        <foreignObject
          width={80}
          height={24}
          x={labelX - 40}
          y={labelY - 12}
        >
          <div className="flex items-center justify-center rounded border border-border bg-muted px-2 py-0.5 text-xs font-mono tabular-nums text-muted-foreground">
            {throughput > 1000
              ? `${(throughput / 1000).toFixed(1)}k/s`
              : `${throughput}/s`}
          </div>
        </foreignObject>
      )}
    </>
  );
}

export const MetricEdge = memo(MetricEdgeComponent);
