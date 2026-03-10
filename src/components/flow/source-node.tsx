"use client";

import { memo, useMemo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VectorComponentDef } from "@/lib/vector/types";
import type { NodeMetricsData } from "@/stores/flow-store";
import { getIcon } from "./node-icon";
import { NodeSparkline } from "./node-sparkline";
import { formatRate, formatBytesRate } from "./node-metrics-format";
import { StatusDot } from "@/components/ui/status-dot";
import { nodeStatusVariant } from "@/lib/status";


type SourceNodeData = {
  componentDef: VectorComponentDef;
  componentKey: string;
  displayName?: string;
  config: Record<string, unknown>;
  metrics?: NodeMetricsData;
  disabled?: boolean;
  isSystemLocked?: boolean;
};

type SourceNodeType = Node<SourceNodeData, "source">;

function SourceNodeComponent({ data, selected }: NodeProps<SourceNodeType>) {
  const { componentDef, componentKey, displayName, metrics, disabled, isSystemLocked } = data;
  const Icon = useMemo(() => getIcon(componentDef.icon), [componentDef.icon]);

  return (
    <div
      className={cn(
        "w-56 rounded-lg border bg-card shadow-sm transition-shadow",
        selected && !isSystemLocked && "ring-2 ring-node-source shadow-md",
        isSystemLocked && "ring-2 ring-blue-400 shadow-md",
        disabled && "opacity-40"
      )}
    >
      {/* Header bar */}
      <div className="flex items-center gap-2 rounded-t-lg bg-node-source px-3 py-2 text-node-source-foreground">
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate text-sm font-medium">
          {componentDef.displayName}
        </span>
        {isSystemLocked && (
          <Lock className="ml-auto h-3.5 w-3.5 shrink-0 opacity-70" />
        )}
      </div>

      {/* Body */}
      <div className="space-y-2 px-3 py-2.5">
        <p className="truncate text-xs font-medium text-foreground">{displayName || componentKey}</p>

        {metrics && (
          <p className="truncate text-xs font-mono text-emerald-400">
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

      {/* Output handle on RIGHT */}
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-node-source !bg-background"
      />
    </div>
  );
}

export const SourceNode = memo(SourceNodeComponent);
