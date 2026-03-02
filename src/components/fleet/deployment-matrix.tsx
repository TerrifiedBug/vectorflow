"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { Minus } from "lucide-react";
import Link from "next/link";
import { StatusDot } from "@/components/ui/status-dot";
import { pipelineStatusVariant, pipelineStatusLabel } from "@/lib/status";

interface DeploymentMatrixProps {
  environmentId: string;
}

export function DeploymentMatrix({ environmentId }: DeploymentMatrixProps) {
  const trpc = useTRPC();

  const matrixQuery = useQuery({
    ...trpc.fleet.listWithPipelineStatus.queryOptions({ environmentId }),
    refetchInterval: 15_000,
  });

  if (matrixQuery.isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading deployment matrix...
      </div>
    );
  }

  const data = matrixQuery.data;

  if (!data || data.deployedPipelines.length === 0) {
    return null;
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
                className="px-3 py-2 text-center font-medium text-muted-foreground"
              >
                <div>{node.name}</div>
                <div className="text-xs font-normal">{node.host}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {deployedPipelines.map((pipeline) => (
            <tr key={pipeline.id} className="hover:bg-muted/30">
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
                    <td key={node.id} className="px-3 py-2 text-center">
                      <div className="flex items-center justify-center">
                        <Minus className="h-4 w-4 text-muted-foreground/50" />
                      </div>
                    </td>
                  );
                }

                const isOutdated = ps.version < pipeline.latestVersion;

                return (
                  <td key={node.id} className="px-3 py-2 text-center">
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
