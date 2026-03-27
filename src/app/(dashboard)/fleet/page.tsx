"use client";

import { useState, useMemo, useCallback } from "react";
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
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StaggerList, StaggerItem } from "@/components/motion/stagger-list";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tag, Wrench } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeploymentMatrix } from "@/components/fleet/deployment-matrix";
import { formatLastSeen } from "@/lib/format";
import { nodeStatusVariant, nodeStatusLabel } from "@/lib/status";
import { isVersionOlder } from "@/lib/version";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { FleetListToolbar } from "@/components/fleet/fleet-list-toolbar";
import { ArrowUp, ArrowDown } from "lucide-react";

const AGENT_REPO = "TerrifiedBug/vectorflow";

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

  // --- Filter state ---
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [labelFilter, setLabelFilter] = useState<Record<string, string>>({});
  type SortField = "name" | "status" | "lastSeen";
  type SortDirection = "asc" | "desc";
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = useCallback(
    (field: SortField) => {
      if (field === sortField) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortField(field);
        setSortDirection("asc");
      }
    },
    [sortField],
  );

  const nodesQuery = useQuery(
    trpc.fleet.list.queryOptions(
      {
        environmentId: activeEnvId,
        ...(search ? { search } : {}),
        ...(statusFilter.length > 0 ? { status: statusFilter } : {}),
        ...(Object.keys(labelFilter).length > 0 ? { labels: labelFilter } : {}),
      },
      { enabled: !!activeEnvId }
    )
  );

  // Available labels for the toolbar
  const labelsQuery = useQuery(
    trpc.fleet.listLabels.queryOptions(
      { environmentId: activeEnvId },
      { enabled: !!activeEnvId },
    ),
  );
  const availableLabels = labelsQuery.data ?? {};

  const isLoading =
    environmentsQuery.isLoading ||
    nodesQuery.isLoading;

  const rawNodes = useMemo(() => nodesQuery.data ?? [], [nodesQuery.data]);

  // Sort client-side
  const nodes = useMemo(() => {
    const sorted = [...rawNodes];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
        case "lastSeen":
          cmp = (new Date(a.lastSeen ?? 0)).getTime() - (new Date(b.lastSeen ?? 0)).getTime();
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [rawNodes, sortField, sortDirection]);

  const versionQuery = useQuery(
    trpc.settings.checkVersion.queryOptions(undefined, {
      refetchInterval: false,
      staleTime: 5 * 60 * 1000,
    }),
  );
  const latestAgentVersion = versionQuery.data?.agent.latestVersion ?? null;
  const agentChecksums = versionQuery.data?.agent.checksums ?? {};
  const latestDevAgentVersion = versionQuery.data?.devAgent?.latestVersion ?? null;
  const devAgentChecksums = versionQuery.data?.devAgent?.checksums ?? {};

  const getNodeLatest = (node: { agentVersion: string | null }) => {
    if (node.agentVersion?.startsWith("dev-")) {
      return { version: latestDevAgentVersion, checksums: devAgentChecksums, tag: "dev" };
    }
    return { version: latestAgentVersion, checksums: agentChecksums, tag: latestAgentVersion ? `v${latestAgentVersion}` : null };
  };

  const triggerUpdate = useMutation(
    trpc.fleet.triggerAgentUpdate.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.fleet.list.queryKey() });
        toast.success("Update triggered");
      },
      onError: (error) => {
        toast.error("Failed to trigger update: " + error.message);
      },
    }),
  );

  const setMaintenance = useMutation(
    trpc.fleet.setMaintenanceMode.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.fleet.list.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.fleet.listWithPipelineStatus.queryKey() });
      },
    }),
  );

  const [maintenanceTarget, setMaintenanceTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  if (nodesQuery.isError) {
    return (
      <div className="space-y-6">
        <QueryError message="Failed to load fleet data" onRetry={() => nodesQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1">
        <span className="rounded-full px-3 h-7 text-xs font-medium border transition-colors bg-accent text-accent-foreground border-transparent inline-flex items-center">
          Nodes
        </span>
        <Link
          href="/fleet/overview"
          className="rounded-full px-3 h-7 text-xs font-medium border transition-colors bg-transparent text-muted-foreground border-border hover:bg-muted inline-flex items-center"
        >
          Overview
        </Link>
        <Link
          href="/fleet/health"
          className="rounded-full px-3 h-7 text-xs font-medium border transition-colors bg-transparent text-muted-foreground border-border hover:bg-muted inline-flex items-center"
        >
          Health
        </Link>
      </div>

      {/* Toolbar — shown when not loading and nodes exist or filters active */}
      {!isLoading && (rawNodes.length > 0 || search || statusFilter.length > 0 || Object.keys(labelFilter).length > 0) && (
        <FleetListToolbar
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          labelFilter={labelFilter}
          onLabelFilterChange={setLabelFilter}
          availableLabels={availableLabels}
        />
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rawNodes.length === 0 && !search && statusFilter.length === 0 && Object.keys(labelFilter).length === 0 ? (
        <EmptyState
          title="No agents enrolled yet"
          description="Generate an enrollment token in the environment settings to connect agents."
        />
      ) : nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No agents match your filters</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setSearch("");
              setStatusFilter([]);
              setLabelFilter({});
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <button
                  type="button"
                  onClick={() => handleSort("name")}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors -ml-1 px-1 rounded"
                >
                  Name
                  {sortField === "name" && (sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                </button>
              </TableHead>
              <TableHead>Host:Port</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Labels</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Agent Version</TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => handleSort("status")}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors -ml-1 px-1 rounded"
                >
                  Status
                  {sortField === "status" && (sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                </button>
              </TableHead>
              <TableHead>
                <button
                  type="button"
                  onClick={() => handleSort("lastSeen")}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors -ml-1 px-1 rounded"
                >
                  Last Seen
                  {sortField === "lastSeen" && (sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                </button>
              </TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <StaggerList as="tbody" className="[&_tr:last-child]:border-0">
            {nodes.map((node) => (
              <StaggerItem as="tr" key={node.id} className="hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors cursor-pointer">
                <TableCell className="font-medium">
                  <Link
                    href={`/fleet/${node.id}`}
                    className="hover:underline"
                  >
                    {node.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-sm tabular-nums">
                  {node.host}:{node.apiPort}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{node.environment.name}</Badge>
                </TableCell>
                <TableCell>
                  {(() => {
                    const entries = Object.entries(
                      (node.labels as Record<string, string>) ?? {},
                    );
                    if (entries.length === 0) return null;
                    return (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
                          >
                            <Tag className="h-3 w-3" />
                            {entries.length} {entries.length === 1 ? "label" : "labels"}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-2" align="start">
                          <div className="flex flex-wrap gap-1">
                            {entries.map(([k, v]) => (
                              <Badge key={k} variant="outline" className="text-xs">
                                {k}={v}
                              </Badge>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>
                    );
                  })()}
                </TableCell>
                <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                  {node.vectorVersion?.split(" ")[1] ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm tabular-nums text-muted-foreground">
                      {node.agentVersion ?? "—"}
                    </span>
                    {getNodeLatest(node).version &&
                      node.agentVersion &&
                      isVersionOlder(node.agentVersion, getNodeLatest(node).version ?? "") && (
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
                  {node.maintenanceMode ? (
                    <Badge variant="outline" className="text-orange-600 border-orange-500/50">
                      <Wrench className="mr-1 h-3 w-3" />
                      Maintenance
                    </Badge>
                  ) : (
                    <StatusBadge variant={nodeStatusVariant(node.status)}>
                      {nodeStatusLabel(node.status)}
                    </StatusBadge>
                  )}
                  {node.pushConnected && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 border-green-500 text-green-600 dark:text-green-400">
                          Live
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        SSE connected — real-time push enabled
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {node.labelCompliant === false && (
                    <Tooltip>
                      <TooltipTrigger>
                        <Badge variant="outline" className="ml-1 text-[10px] px-1 py-0 border-amber-500 text-amber-600 dark:text-amber-400">
                          Non-compliant
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        This node is missing one or more required labels defined in node groups
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatLastSeen(node.lastSeen)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Button
                      variant={node.maintenanceMode ? "default" : "outline"}
                      size="sm"
                      disabled={setMaintenance.isPending && setMaintenance.variables?.nodeId === node.id}
                      onClick={(e) => {
                        e.preventDefault();
                        if (!node.maintenanceMode) {
                          setMaintenanceTarget({ id: node.id, name: node.name });
                        } else {
                          setMaintenance.mutate({
                            nodeId: node.id,
                            enabled: false,
                          });
                        }
                      }}
                    >
                      <Wrench className="mr-1 h-3.5 w-3.5" />
                      {node.maintenanceMode ? "Exit Maintenance" : "Maintenance"}
                    </Button>
                    {node.pendingAction ? (
                      <Badge variant="outline" className="text-blue-600">
                        Update pending...
                      </Badge>
                    ) : node.deploymentMode === "DOCKER" ? (
                      getNodeLatest(node).version &&
                      node.agentVersion &&
                      isVersionOlder(node.agentVersion, getNodeLatest(node).version ?? "") ? (
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
                    ) : getNodeLatest(node).version &&
                      node.agentVersion &&
                      isVersionOlder(node.agentVersion, getNodeLatest(node).version ?? "") ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={triggerUpdate.isPending}
                        onClick={(e) => {
                          e.preventDefault();
                          const latest = getNodeLatest(node);
                          triggerUpdate.mutate({
                            nodeId: node.id,
                            targetVersion: latest.version!,
                            downloadUrl: `https://github.com/${AGENT_REPO}/releases/download/${latest.tag}/vf-agent-linux-amd64`,
                            checksum: `sha256:${latest.checksums["vf-agent-linux-amd64"] ?? ""}`,
                          });
                        }}
                      >
                        {triggerUpdate.isPending ? "Updating..." : "Update"}
                      </Button>
                    ) : null}
                    {node.lastUpdateError && !node.pendingAction && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="destructive" className="text-xs">
                            Update failed
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>{node.lastUpdateError}</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
              </StaggerItem>
            ))}
          </StaggerList>
        </Table>
      )}

      {activeEnvId && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Pipeline Deployment Matrix</h3>
          <DeploymentMatrix environmentId={activeEnvId} />
        </div>
      )}

      <ConfirmDialog
        open={!!maintenanceTarget}
        onOpenChange={(open) => { if (!open) setMaintenanceTarget(null); }}
        title="Enter maintenance mode?"
        description={
          <>
            This will stop all running pipelines on &quot;{maintenanceTarget?.name}&quot;.
            Pipelines will automatically resume when maintenance mode is turned off.
          </>
        }
        confirmLabel="Enter Maintenance"
        variant="default"
        isPending={setMaintenance.isPending}
        pendingLabel="Entering..."
        onConfirm={() => {
          if (maintenanceTarget) {
            setMaintenance.mutate(
              { nodeId: maintenanceTarget.id, enabled: true },
              { onSuccess: () => setMaintenanceTarget(null) },
            );
          }
        }}
      />
    </div>
  );
}
