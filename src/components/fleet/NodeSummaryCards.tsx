"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/ui/status-dot";
import { nodeStatusVariant } from "@/lib/status";
import { cn } from "@/lib/utils";
import { AlertTriangle, Server, Wrench, GitCompareArrows } from "lucide-react";

interface NodeSummaryCardsProps {
  environmentId: string;
  onNodeClick?: (nodeId: string) => void;
}

export function NodeSummaryCards({
  environmentId,
  onNodeClick,
}: NodeSummaryCardsProps) {
  const trpc = useTRPC();
  const polling = usePollingInterval(15_000);

  const summaryQuery = useQuery({
    ...trpc.fleet.matrixSummary.queryOptions({ environmentId }),
    refetchInterval: polling,
  });

  if (summaryQuery.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  const nodes = summaryQuery.data ?? [];

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {nodes.map((node) => {
        const hasIssues = node.errorCount > 0 || node.versionDriftCount > 0;
        return (
          <button
            key={node.nodeId}
            type="button"
            onClick={() => onNodeClick?.(node.nodeId)}
            className={cn(
              "flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
              hasIssues && "border-yellow-500/30 bg-yellow-50/30 dark:bg-yellow-950/10",
              node.maintenanceMode && "opacity-60"
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <StatusDot variant={nodeStatusVariant(node.status)} />
                <span className="text-sm font-medium truncate max-w-[120px]">
                  {node.nodeName}
                </span>
              </div>
              {node.maintenanceMode && (
                <Wrench className="h-3.5 w-3.5 text-orange-500" />
              )}
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <Server className="h-3 w-3" />
                <span>{node.pipelineCount}</span>
              </div>
              {node.errorCount > 0 && (
                <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-3 w-3" />
                  <span>{node.errorCount}</span>
                </div>
              )}
              {node.versionDriftCount > 0 && (
                <div className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                  <GitCompareArrows className="h-3 w-3" />
                  <span>{node.versionDriftCount}</span>
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
