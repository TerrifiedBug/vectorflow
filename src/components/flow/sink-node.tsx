"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { VectorComponentDef, DataType } from "@/lib/vector/types";
import type { NodeMetricsData } from "@/stores/flow-store";
import { getIcon } from "./node-icon";
import { NodeSparkline } from "./node-sparkline";
import { formatRate, formatBytesRate } from "./node-metrics-format";

type SinkNodeData = {
  componentDef: VectorComponentDef;
  componentKey: string;
  config: Record<string, unknown>;
  metrics?: NodeMetricsData;
  disabled?: boolean;
};

const statusColors: Record<string, string> = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-500",
  unreachable: "bg-red-500",
};

type SinkNodeType = Node<SinkNodeData, "sink">;

const dataTypeBadgeColor: Record<DataType, string> = {
  log: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  metric:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  trace:
    "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300",
};

function getConfigSummary(config: Record<string, unknown>): string | null {
  const entries = Object.entries(config);
  if (entries.length === 0) return null;

  const [key, value] = entries[0];
  if (value === undefined || value === null) return null;
  const display =
    typeof value === "string"
      ? value
      : Array.isArray(value)
        ? value.slice(0, 2).join(", ")
        : String(value);

  const truncated = display.length > 30 ? display.slice(0, 27) + "..." : display;
  return `${key}: ${truncated}`;
}

function SinkNodeComponent({ data, selected }: NodeProps<SinkNodeType>) {
  const { componentDef, componentKey, config, metrics, disabled } = data;
  const Icon = getIcon(componentDef.icon);
  const configSummary = getConfigSummary(config);

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card shadow-sm transition-shadow",
        selected && "ring-2 ring-node-sink shadow-md",
        disabled && "opacity-40"
      )}
    >
      {/* Input handle on LEFT */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-node-sink !bg-background"
      />

      {/* Header bar */}
      <div className="flex items-center gap-2 rounded-t-lg bg-node-sink px-3 py-2 text-node-sink-foreground">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate text-sm font-medium">
          {componentDef.displayName}
        </span>
      </div>

      {/* Body */}
      <div className="space-y-2 px-3 py-2.5">
        <p className={cn("truncate text-sm font-medium text-foreground", disabled && "line-through")}>
          {componentKey}
        </p>

        {configSummary && (
          <p className="truncate text-xs text-muted-foreground">
            {configSummary}
          </p>
        )}

        {/* Data type badges */}
        <div className="flex flex-wrap gap-1">
          {(componentDef.inputTypes ?? []).map((dt) => (
            <Badge
              key={dt}
              variant="secondary"
              className={cn("px-1.5 py-0 text-[10px]", dataTypeBadgeColor[dt])}
            >
              {dt.charAt(0).toUpperCase() + dt.slice(1)}
            </Badge>
          ))}
        </div>
      </div>

      {/* Monitoring overlay */}
      {metrics && (
        <div className="flex items-center gap-2 border-t px-3 py-1.5 text-xs">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              statusColors[metrics.status] ?? "bg-gray-400"
            )}
          />
          <span className="text-muted-foreground">
            {metrics.eventsPerSec} events/s
          </span>
        </div>
      )}
    </div>
  );
}

export const SinkNode = memo(SinkNodeComponent);
