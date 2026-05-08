"use client";

import { memo } from "react";
import { type Node, type NodeProps } from "@xyflow/react";
import { Link2 as LinkIcon, AlertCircle } from "lucide-react";
import type { VectorComponentDef } from "@/lib/vector/types";
import { useFlowStore } from "@/stores/flow-store";
import type { NodeMetricsData } from "@/stores/flow-store";
import { formatRate } from "./node-metrics-format";
import { NodeShell } from "./node-shell";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SinkNodeData = {
  componentDef: VectorComponentDef;
  componentKey: string;
  displayName?: string;
  config: Record<string, unknown>;
  metrics?: NodeMetricsData;
  disabled?: boolean;
  hasError?: boolean;
  firstErrorMessage?: string;
  sharedComponentId?: string | null;
  sharedComponentVersion?: number | null;
  sharedComponentLatestVersion?: number | null;
  sharedComponentName?: string | null;
};

type SinkNodeType = Node<SinkNodeData, "sink">;

function SinkNodeComponent({ id, data, selected }: NodeProps<SinkNodeType>) {
  const { componentDef, displayName, metrics, disabled } = data;
  const isShared = !!data.sharedComponentId;
  const isSearching = useFlowStore((s) => s.canvasSearchTerm.length > 0);
  const isSearchMatch = useFlowStore((s) => s.canvasSearchMatchIds.includes(id));

  const throughput = metrics
    ? `${formatRate(metrics.eventsPerSec)} ev/s`
    : undefined;

  const badge = data.hasError ? (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
            <AlertCircle className="h-3 w-3" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          {data.firstErrorMessage || "Fix config errors before deploying"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : isShared ? (
    <div
      className="flex h-5 w-5 items-center justify-center rounded-full"
      style={{ background: "var(--node-shared)" }}
    >
      <LinkIcon className="h-3 w-3 text-white" />
    </div>
  ) : null;

  return (
    <NodeShell
      kind="sink"
      typeLabel="SINK"
      name={displayName || componentDef.displayName}
      monoName={componentDef.type}
      throughput={throughput}
      selected={!!selected}
      disabled={disabled}
      fadedForSearch={isSearching && !isSearchMatch}
      searchMatch={isSearchMatch}
      badge={badge}
    />
  );
}

export const SinkNode = memo(SinkNodeComponent);
