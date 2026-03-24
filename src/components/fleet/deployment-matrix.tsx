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

interface DeploymentMatrixProps {
  environmentId: string;
}

export function DeploymentMatrix({ environmentId }: DeploymentMatrixProps) {
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
                  <td key={node.id} className={`px-3 py-2 text-center ${node.maintenanceMode ? "opacity-30" : ""}`}>
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
