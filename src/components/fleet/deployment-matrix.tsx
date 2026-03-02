"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, AlertCircle, Clock, XCircle, Minus } from "lucide-react";
import Link from "next/link";

interface DeploymentMatrixProps {
  environmentId: string;
}

const processStatusConfig: Record<
  string,
  { icon: typeof CheckCircle; color: string; label: string }
> = {
  RUNNING: { icon: CheckCircle, color: "text-green-500", label: "Running" },
  STARTING: { icon: Clock, color: "text-yellow-500", label: "Starting" },
  STOPPED: { icon: XCircle, color: "text-muted-foreground", label: "Stopped" },
  CRASHED: { icon: AlertCircle, color: "text-red-500", label: "Crashed" },
  PENDING: { icon: Clock, color: "text-blue-500", label: "Pending" },
};

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

                const cfg =
                  processStatusConfig[ps.status] ?? processStatusConfig.PENDING;
                const Icon = cfg.icon;
                const isOutdated = ps.version < pipeline.latestVersion;

                return (
                  <td key={node.id} className="px-3 py-2 text-center">
                    <div className="flex flex-col items-center gap-0.5">
                      <div
                        className="flex items-center gap-1"
                        title={cfg.label}
                      >
                        <Icon className={`h-4 w-4 ${cfg.color}`} />
                        <span className="text-xs text-muted-foreground">
                          v{ps.version}
                        </span>
                      </div>
                      {isOutdated && (
                        <span className="text-xs text-yellow-500">
                          (outdated)
                        </span>
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
