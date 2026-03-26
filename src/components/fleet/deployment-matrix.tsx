"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Minus, Wrench } from "lucide-react";
import Link from "next/link";
import { StatusDot } from "@/components/ui/status-dot";
import { pipelineStatusVariant, pipelineStatusLabel } from "@/lib/status";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import { formatEventsRate } from "@/lib/format";
import type { TimeRange } from "@/server/services/fleet-data";

interface MatrixCellThroughput {
  pipelineId: string;
  nodeId: string;
  eventsPerSec: number;
  bytesPerSec: number;
  lossRate: number;
}

interface DeploymentMatrixProps {
  environmentId: string;
  range?: TimeRange;
  lossThreshold?: number;
  throughputData?: MatrixCellThroughput[];
}

export function DeploymentMatrix({
  environmentId,
  lossThreshold = 0.05,
  throughputData,
}: DeploymentMatrixProps) {
  const trpc = useTRPC();
  const polling = usePollingInterval(15_000);

  const matrixQuery = useQuery({
    ...trpc.fleet.listWithPipelineStatus.queryOptions({ environmentId }),
    refetchInterval: polling,
  });

  if (matrixQuery.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  const data = matrixQuery.data;

  if (!data || data.deployedPipelines.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">No pipelines deployed</p>
      </div>
    );
  }

  const { nodes, deployedPipelines } = data;

  if (nodes.length === 0) {
    return null;
  }

  // Index throughput data by pipelineId:nodeId for O(1) lookup
  const throughputMap = new Map<string, MatrixCellThroughput>();
  if (throughputData) {
    for (const cell of throughputData) {
      throughputMap.set(`${cell.pipelineId}:${cell.nodeId}`, cell);
    }
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
              Pipeline
            </th>
            {nodes.map((node) => (
              <th
                key={node.id}
                className={`px-3 py-2 text-center font-medium text-muted-foreground ${
                  node.maintenanceMode ? "bg-orange-50/50 dark:bg-orange-950/10" : ""
                }`}
              >
                <div>{node.name}</div>
                <div className="text-xs font-normal">{node.host}</div>
                {node.maintenanceMode && (
                  <div className="mt-1 flex items-center justify-center gap-1 text-xs text-orange-600 dark:text-orange-400">
                    <Wrench className="h-3 w-3" />
                    Maintenance
                  </div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {deployedPipelines.map((pipeline) => (
            <tr key={pipeline.id} className="transition-colors hover:bg-muted/50">
              <td className="px-3 py-2 font-medium">
                <div className="flex items-center gap-2">
                  <Link href={`/pipelines/${pipeline.id}`} className="hover:underline">
                    {pipeline.name}
                  </Link>
                  <Badge variant="outline" className="text-xs">
                    v{pipeline.latestVersion}
                  </Badge>
                </div>
              </td>
              {nodes.map((node) => {
                const ps = node.pipelineStatuses.find(
                  (s) => s.pipelineId === pipeline.id
                );
                const cellThroughput = throughputMap.get(
                  `${pipeline.id}:${node.id}`
                );
                const hasLoss =
                  cellThroughput != null &&
                  cellThroughput.lossRate > lossThreshold;

                if (!ps) {
                  return (
                    <td key={node.id} className={`px-3 py-2 text-center ${node.maintenanceMode ? "opacity-30" : ""}`}>
                      <div className="flex items-center justify-center">
                        <Minus className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    </td>
                  );
                }

                const isOutdated = ps.version < pipeline.latestVersion;

                return (
                  <td
                    key={node.id}
                    className={`px-3 py-2 text-center ${
                      node.maintenanceMode ? "opacity-30" : ""
                    } ${
                      hasLoss
                        ? "bg-red-50/60 dark:bg-red-950/20 border-l border-r border-red-200/50 dark:border-red-800/30"
                        : ""
                    }`}
                  >
                    <div className="flex flex-col items-center gap-0.5">
                      {isOutdated ? (
                        <div
                          className="flex items-center gap-1"
                          title={`Deployed: v${ps.version}, Latest: v${pipeline.latestVersion}`}
                        >
                          <StatusDot variant={pipelineStatusVariant(ps.status)} />
                          <Badge
                            variant="outline"
                            className="text-xs border-yellow-500/50 text-yellow-600 dark:text-yellow-400"
                          >
                            v{ps.version}
                          </Badge>
                        </div>
                      ) : (
                        <div
                          className="flex items-center gap-1"
                          title={pipelineStatusLabel(ps.status)}
                        >
                          <StatusDot variant={pipelineStatusVariant(ps.status)} />
                        </div>
                      )}
                      {cellThroughput != null && (
                        <div
                          className={`text-[10px] tabular-nums ${
                            hasLoss
                              ? "text-red-600 dark:text-red-400 font-medium"
                              : "text-muted-foreground"
                          }`}
                          title={
                            hasLoss
                              ? `${(cellThroughput.lossRate * 100).toFixed(1)}% data loss`
                              : undefined
                          }
                        >
                          {formatEventsRate(cellThroughput.eventsPerSec)}
                          {hasLoss && (
                            <span className="ml-0.5">
                              ⚠
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
