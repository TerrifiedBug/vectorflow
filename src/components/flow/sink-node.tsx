"use client";

import { memo, useMemo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import type { VectorComponentDef } from "@/lib/vector/types";
import type { NodeMetricsData } from "@/stores/flow-store";
import { getIcon } from "./node-icon";
import { NodeSparkline } from "./node-sparkline";
import { formatRate, formatBytesRate } from "./node-metrics-format";
import { StatusDot } from "@/components/ui/status-dot";
import { nodeStatusVariant } from "@/lib/status";


type SinkNodeData = {
  componentDef: VectorComponentDef;
  componentKey: string;
  displayName?: string;
  config: Record<string, unknown>;
  metrics?: NodeMetricsData;
  disabled?: boolean;
};

type SinkNodeType = Node<SinkNodeData, "sink">;

function SinkNodeComponent({ data, selected }: NodeProps<SinkNodeType>) {
  const { componentDef, componentKey, displayName, metrics, disabled } = data;
  const Icon = useMemo(() => getIcon(componentDef.icon), [componentDef.icon]);

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
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate text-sm font-medium">
          {componentDef.displayName}
        </span>
      </div>

      {/* Body */}
      <div className="space-y-2 px-3 py-2.5">
        <p className="truncate text-xs font-medium text-foreground">{displayName ?? componentKey}</p>

        {metrics && (
          <p className="truncate text-xs font-mono text-purple-400">
            {formatRate(metrics.eventsPerSec)} ev/s{"  "}{formatBytesRate(metrics.bytesPerSec)}
          </p>
        )}
      </div>

      {/* Monitoring overlay */}
      {metrics && (
        <div className="flex items-center gap-2 border-t px-3 py-1.5 text-xs">
          <StatusDot variant={nodeStatusVariant(metrics.status)} />
          {metrics.samples && metrics.samples.length > 1 && (
            <NodeSparkline samples={metrics.samples} />
          )}
        </div>
      )}
    </div>
  );
}

export const SinkNode = memo(SinkNodeComponent);
