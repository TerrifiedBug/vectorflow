"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { DeploymentMatrix } from "@/components/fleet/deployment-matrix";
import { formatLastSeen } from "@/lib/format";
import { nodeStatusVariant, nodeStatusLabel } from "@/lib/status";
import { isVersionOlder } from "@/lib/version";

const AGENT_REPO = "terrifiedbug/vectorflow-agent";

export default function FleetPage() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId }
    )
  );

  const environments = environmentsQuery.data ?? [];

  // Pick the first environment if none is selected yet
  const activeEnvId = selectedEnvironmentId || environments[0]?.id || "";
  const nodesQuery = useQuery(
    trpc.fleet.list.queryOptions(
      { environmentId: activeEnvId },
      { enabled: !!activeEnvId }
    )
  );

  const isLoading =
    environmentsQuery.isLoading ||
    nodesQuery.isLoading;

  const nodes = nodesQuery.data ?? [];

  const versionQuery = useQuery(
    trpc.settings.checkVersion.queryOptions(undefined, {
      refetchInterval: false,
      staleTime: Infinity,
    }),
  );
  const latestAgentVersion = versionQuery.data?.agent.latestVersion ?? null;
  const agentChecksums = versionQuery.data?.agent.checksums ?? {};

  const triggerUpdate = useMutation(
    trpc.fleet.triggerAgentUpdate.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.fleet.list.queryKey() });
      },
    }),
  );

  return (
    <div className="space-y-6">
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No agents enrolled yet</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Generate an enrollment token in the environment settings to connect agents.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Host:Port</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Agent Version</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Seen</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {nodes.map((node) => (
              <TableRow key={node.id} className="cursor-pointer hover:bg-muted/50">
                <TableCell className="font-medium">
                  <Link
                    href={`/fleet/${node.id}`}
                    className="hover:underline"
                  >
                    {node.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-sm">
                  {node.host}:{node.apiPort}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{node.environment.name}</Badge>
                </TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {node.vectorVersion?.split(" ")[1] ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-muted-foreground">
                      {node.agentVersion ?? "—"}
                    </span>
                    {latestAgentVersion &&
                      node.agentVersion &&
                      isVersionOlder(node.agentVersion, latestAgentVersion) && (
                        <Badge variant="outline" className="text-amber-600">
                          Update available
                        </Badge>
                      )}
                    {node.deploymentMode === "DOCKER" && (
                      <Badge variant="secondary" className="text-xs">
                        Docker
                      </Badge>
                    )}
                    {node.deploymentMode === "STANDALONE" && (
                      <Badge variant="secondary" className="text-xs">
                        Binary
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <StatusBadge variant={nodeStatusVariant(node.status)}>
                    {nodeStatusLabel(node.status)}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatLastSeen(node.lastSeen)}
                </TableCell>
                <TableCell>
                  {node.pendingAction ? (
                    <Badge variant="outline" className="text-blue-600">
                      Update pending...
                    </Badge>
                  ) : node.deploymentMode === "DOCKER" ? (
                    latestAgentVersion &&
                    node.agentVersion &&
                    isVersionOlder(node.agentVersion, latestAgentVersion) ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span>
                            <Button variant="outline" size="sm" disabled>
                              Update
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>Update via Docker image pull</TooltipContent>
                      </Tooltip>
                    ) : null
                  ) : latestAgentVersion &&
                    node.agentVersion &&
                    isVersionOlder(node.agentVersion, latestAgentVersion) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={triggerUpdate.isPending}
                      onClick={(e) => {
                        e.preventDefault();
                        triggerUpdate.mutate({
                          nodeId: node.id,
                          targetVersion: latestAgentVersion,
                          downloadUrl: `https://github.com/${AGENT_REPO}/releases/download/v${latestAgentVersion}/vf-agent-linux-amd64`,
                          checksum: `sha256:${agentChecksums["vf-agent-linux-amd64"] ?? ""}`,
                        });
                      }}
                    >
                      {triggerUpdate.isPending ? "Updating..." : "Update"}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {activeEnvId && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Pipeline Deployment Matrix</h3>
          <DeploymentMatrix environmentId={activeEnvId} />
        </div>
      )}
    </div>
  );
}
