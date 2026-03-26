"use client";

import { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { aggregateProcessStatus } from "@/lib/pipeline-status";

export type DependencyGraphNodeData = {
  name: string;
  isDraft: boolean;
  nodeStatuses: Array<{ status: string }>;
};

type DependencyGraphNodeType = Node<DependencyGraphNodeData, "pipeline">;

function DependencyGraphNodeComponent({
  data,
}: NodeProps<DependencyGraphNodeType>) {
  const { name, isDraft, nodeStatuses } = data;

  const status = isDraft ? null : aggregateProcessStatus(nodeStatuses);

  const statusLabel = isDraft ? "Draft" : status ?? "Pending";
  const statusVariant: "secondary" | "default" | "destructive" | "outline" =
    isDraft
      ? "secondary"
      : status === "CRASHED"
        ? "destructive"
        : status === "RUNNING"
          ? "default"
          : "outline";

  return (
    <div className="w-[220px] rounded-lg border bg-card px-4 py-3 shadow-sm">
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !border-2 !border-muted-foreground !bg-background"
      />

      <p className="truncate text-sm font-semibold text-foreground">{name}</p>
      <Badge variant={statusVariant} size="sm" className="mt-1.5">
        {statusLabel}
      </Badge>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !border-2 !border-muted-foreground !bg-background"
      />
    </div>
  );
}

export const DependencyGraphNode = memo(DependencyGraphNodeComponent);

export const dependencyGraphNodeTypes = {
  pipeline: DependencyGraphNode,
} as const;
