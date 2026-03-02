"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";

import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { DeploymentMatrix } from "@/components/fleet/deployment-matrix";
import { formatLastSeen } from "@/lib/format";
import { nodeStatusVariant, nodeStatusLabel } from "@/lib/status";

export default function FleetPage() {
  const trpc = useTRPC();
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Fleet</h2>
          <p className="text-muted-foreground">
            Manage your Vector node fleet
          </p>
        </div>
      </div>

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
              <TableHead>Status</TableHead>
              <TableHead>Last Seen</TableHead>
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
                  <StatusBadge variant={nodeStatusVariant(node.status)}>
                    {nodeStatusLabel(node.status)}
                  </StatusBadge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatLastSeen(node.lastSeen)}
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
