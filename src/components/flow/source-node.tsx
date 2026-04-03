"use client";

import { memo, useMemo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Lock, Link2 as LinkIcon, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VectorComponentDef } from "@/lib/vector/types";
import { useFlowStore } from "@/stores/flow-store";
import type { NodeMetricsData } from "@/stores/flow-store";
import { getIcon } from "./node-icon";
import { NodeSparkline } from "./node-sparkline";
import { formatRate, formatBytesRate, formatLatency } from "./node-metrics-format";
import { StatusDot } from "@/components/ui/status-dot";
import { nodeStatusVariant } from "@/lib/status";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";


type SourceNodeData = {
  componentDef: VectorComponentDef;
  componentKey: string;
  displayName?: string;
  config: Record<string, unknown>;
  metrics?: NodeMetricsData;
  disabled?: boolean;
  isSystemLocked?: boolean;
  hasError?: boolean;
  firstErrorMessage?: string;
  sharedComponentId?: string | null;
  sharedComponentVersion?: number | null;
  sharedComponentLatestVersion?: number | null;
  sharedComponentName?: string | null;
};

type SourceNodeType = Node<SourceNodeData, "source">;

function SourceNodeComponent({ id, data, selected }: NodeProps<SourceNodeType>) {
  const { componentDef, displayName, metrics, disabled, isSystemLocked } = data;
  const isShared = !!data.sharedComponentId;
  const isStale = isShared && data.sharedComponentLatestVersion != null &&
    (data.sharedComponentVersion ?? 0) < data.sharedComponentLatestVersion;
  const Icon = useMemo(() => getIcon(componentDef.icon), [componentDef.icon]);
  const isSearching = useFlowStore((s) => s.canvasSearchTerm.length > 0);
  const isSearchMatch = useFlowStore((s) => s.canvasSearchMatchIds.includes(id));

  return (
    <div className={cn("relative", isSearching && !isSearchMatch && "opacity-40")}>
      {data.hasError && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="absolute -top-2 -right-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
                <AlertCircle className="h-3 w-3" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top">
              {data.firstErrorMessage || "Fix config errors before deploying"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      <div
        className={cn(
          "w-56 rounded-lg border bg-card shadow-sm transition-[transform,box-shadow] duration-200 overflow-hidden",
          "ring-2 ring-transparent",
          "hover:-translate-y-0.5 hover:shadow-[0_0_12px_var(--node-source-glow)]",
          selected && !isSystemLocked && !isShared && "ring-node-source shadow-md",
          selected && isShared && "ring-purple-400 shadow-md",
          isShared && !selected && "border-purple-400/50 shadow-[0_0_8px_rgba(167,139,250,0.15)]",
          isSystemLocked && "ring-blue-400 shadow-md",
          disabled && "opacity-40",
          data.hasError && "ring-destructive shadow-md",
          isSearchMatch && "ring-2 ring-yellow-400"
        )}
      >
        {/* Header bar */}
        <div className="flex items-center gap-2 bg-node-source px-3 py-2 text-node-source-foreground">
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
          {displayName && <p className="truncate text-xs font-medium text-foreground">{displayName}</p>}

          {metrics && (
            <p className="truncate text-xs font-mono tabular-nums text-emerald-400">
              {formatRate(metrics.eventsPerSec)} ev/s{"  "}{formatBytesRate(metrics.bytesPerSec)}
              {metrics.latencyMs != null && metrics.latencyMs > 0 && (
                <>{"  "}{formatLatency(metrics.latencyMs)}</>
              )}
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

        {isShared && (
          <div className="flex items-center gap-1.5 border-t px-3 py-1.5 text-[10px] text-purple-400">
            <LinkIcon className="h-3 w-3" />
            {isStale ? (
              <span className="text-amber-400">Update available</span>
            ) : (
              <span>Shared</span>
            )}
            {isStale && <span className="ml-auto h-2 w-2 rounded-full bg-amber-400" />}
          </div>
        )}

        {/* Output handle on RIGHT */}
        <Handle
          type="source"
          position={Position.Right}
          className="!h-3 !w-3 !border-2 !border-node-source !bg-background"
        />
      </div>
    </div>
  );
}

export const SourceNode = memo(SourceNodeComponent);
