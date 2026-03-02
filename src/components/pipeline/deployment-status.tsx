"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { pipelineStatusVariant, pipelineStatusLabel } from "@/lib/status";

interface DeploymentStatusProps {
  pipelineId: string;
}

function formatUptime(seconds: number | null): string {
  if (!seconds) return "\u2014";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function DeploymentStatus({ pipelineId }: DeploymentStatusProps) {
  const trpc = useTRPC();

  const statusQuery = useQuery({
    ...trpc.pipeline.deploymentStatus.queryOptions({ pipelineId }),
    refetchInterval: 15_000, // Refresh every 15s to match heartbeat interval
  });

  if (statusQuery.isLoading) {
    return <div className="text-xs text-muted-foreground">Loading status...</div>;
  }

  const status = statusQuery.data;

  if (!status) {
    return null;
  }

  if (status.nodes.length === 0) {
    return (
      <div className="rounded-md border p-3 text-xs text-muted-foreground">
        No agents have reported status for this pipeline yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Agent Deployment Status</span>
        {status.deployed && (
          <Badge variant="outline" className="text-xs">v{status.latestVersion}</Badge>
        )}
      </div>
      <div className="rounded-md border divide-y">
        {status.nodes.map((node) => {
          return (
            <div key={node.nodeId} className="flex items-center justify-between px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <StatusDot variant={pipelineStatusVariant(node.pipelineStatus)} />
                <span className="font-medium">{node.nodeName}</span>
                <span className="text-muted-foreground">{node.nodeHost}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">
                  v{node.runningVersion}
                  {!node.isLatest && (
                    <span className="ml-1 text-yellow-500">(outdated)</span>
                  )}
                </span>
                <span className="text-muted-foreground">{formatUptime(node.uptimeSeconds)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
