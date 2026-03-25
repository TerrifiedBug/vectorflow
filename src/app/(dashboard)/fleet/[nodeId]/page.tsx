"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import Link from "next/link";
import { ShieldOff, Trash2, Activity, Pencil, Check, X, Wrench, Plus, Tag } from "lucide-react";
import { NodeLogs } from "@/components/fleet/node-logs";
import { toast } from "sonner";
import { useState } from "react";
import { usePollingInterval } from "@/hooks/use-polling-interval";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { NodeMetricsCharts } from "@/components/fleet/node-metrics-charts";
import { UptimeCards } from "@/components/fleet/uptime-cards";
import { StatusTimeline } from "@/components/fleet/status-timeline";
import { EventLog } from "@/components/fleet/event-log";
import {
  formatTimestamp as formatLastSeen,
  formatCount,
  formatBytes,
  formatBytesRate,
  formatLatency,
} from "@/lib/format";
import { nodeStatusVariant, nodeStatusLabel, pipelineStatusVariant, pipelineStatusLabel } from "@/lib/status";

/** Thin wrapper that appends "/s" to the shared formatRate for display. */
function formatRate(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M/s`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K/s`;
  if (n >= 1) return `${n.toFixed(1)}/s`;
  if (n > 0) return `${n.toFixed(2)}/s`;
  return "0/s";
}

function formatUptime(seconds: number | null): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function NodeDetailPage() {
  const params = useParams<{ nodeId: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState("");
  const [isEditingLabels, setIsEditingLabels] = useState(false);
  const [editLabels, setEditLabels] = useState<Array<{ key: string; value: string }>>([]);
  const [timelineRange, setTimelineRange] = useState<"1h" | "6h" | "1d" | "7d" | "30d">("1d");

  const nodePolling = usePollingInterval(15_000);

  const nodeQuery = useQuery(
    trpc.fleet.get.queryOptions(
      { id: params.nodeId },
      { refetchInterval: nodePolling },
    )
  );

  const node = nodeQuery.data;

  // Fetch live per-pipeline rates from MetricStore
  const ratesQuery = useQuery(
    trpc.metrics.getNodePipelineRates.queryOptions(
      { nodeId: params.nodeId },
      { enabled: !!node, refetchInterval: nodePolling },
    )
  );
  const pipelineRates = ratesQuery.data?.rates ?? {};

  const handleStartRename = () => {
    setEditName(node?.name ?? "");
    setIsRenaming(true);
  };

  const handleConfirmRename = () => {
    const trimmed = editName.trim();
    if (!trimmed || !node || trimmed === node.name) {
      setIsRenaming(false);
      return;
    }
    updateMutation.mutate(
      { id: node.id, name: trimmed },
      { onSuccess: () => setIsRenaming(false) },
    );
  };

  const updateMutation = useMutation(
    trpc.fleet.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.fleet.get.queryKey({ id: params.nodeId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.fleet.list.queryKey(),
        });
      },
    })
  );

  const deleteMutation = useMutation(
    trpc.fleet.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.fleet.list.queryKey(),
        });
        router.push("/fleet");
      },
    })
  );

  const revokeMutation = useMutation(
    trpc.fleet.revokeNode.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.fleet.get.queryKey({ id: params.nodeId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.fleet.list.queryKey(),
        });
        toast.success("Node token revoked");
      },
    })
  );

  const maintenanceMutation = useMutation(
    trpc.fleet.setMaintenanceMode.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.fleet.get.queryKey({ id: params.nodeId }) });
        queryClient.invalidateQueries({ queryKey: trpc.fleet.list.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.fleet.listWithPipelineStatus.queryKey() });
      },
    }),
  );

  const labelsMutation = useMutation(
    trpc.fleet.updateLabels.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.fleet.get.queryKey({ id: params.nodeId }) });
        queryClient.invalidateQueries({ queryKey: trpc.fleet.list.queryKey() });
        toast.success("Labels updated");
        setIsEditingLabels(false);
      },
    }),
  );

  function handleStartEditLabels() {
    const labels = (node?.labels as Record<string, string>) ?? {};
    const entries = Object.entries(labels).map(([key, value]) => ({ key, value }));
    if (entries.length === 0) entries.push({ key: "", value: "" });
    setEditLabels(entries);
    setIsEditingLabels(true);
  }

  function handleSaveLabels() {
    if (!node) return;
    const labels: Record<string, string> = {};
    for (const { key, value } of editLabels) {
      const k = key.trim();
      if (k) labels[k] = value.trim();
    }
    labelsMutation.mutate({ nodeId: node.id, labels });
  }

  function handleMaintenanceToggle() {
    if (!node) return;
    if (!node.maintenanceMode) {
      const runningCount = node.pipelineStatuses.filter(
        (s) => s.status === "RUNNING"
      ).length;
      if (!confirm(
        `Enter maintenance mode for "${node.name}"?\n\nThis will stop ${runningCount} running pipeline(s) on this node. Pipelines will automatically resume when maintenance mode is turned off.`
      )) return;
    }
    maintenanceMutation.mutate({
      nodeId: node.id,
      enabled: !node.maintenanceMode,
    });
  }

  function handleRevoke() {
    if (!node) return;
    if (!confirm(`Revoke token for "${node.name}"? The agent will no longer be able to connect.`)) {
      return;
    }
    revokeMutation.mutate({ id: node.id });
  }

  function handleDelete() {
    if (!node) return;
    if (!confirm(`Delete node "${node.name}"? This action cannot be undone.`)) {
      return;
    }
    deleteMutation.mutate({ id: node.id });
  }

  if (nodeQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (nodeQuery.isError || !node) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-1.5 text-sm">
          <Link href="/fleet" className="text-muted-foreground hover:text-foreground transition-colors">
            Fleet
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="font-medium">Not found</span>
        </div>
        <EmptyState title="Node not found" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-sm">
            <Link href="/fleet" className="text-muted-foreground hover:text-foreground transition-colors">
              Fleet
            </Link>
            <span className="text-muted-foreground">/</span>
          </div>
          <div>
            {isRenaming ? (
              <div className="flex items-center gap-1">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleConfirmRename();
                    if (e.key === "Escape") setIsRenaming(false);
                  }}
                  className="h-9 w-64 text-lg font-bold"
                  autoFocus
                  disabled={updateMutation.isPending}
                />
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={handleConfirmRename} disabled={updateMutation.isPending} aria-label="Confirm rename">
                  <Check className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setIsRenaming(false)} aria-label="Cancel rename">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <button
                onClick={handleStartRename}
                className="group flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-2xl font-semibold tracking-tight hover:bg-accent transition-colors"
                title="Click to rename"
              >
                {node.name}
                <Pencil className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
            <p className="text-muted-foreground">
              {node.host}:{node.apiPort}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={node.maintenanceMode ? "default" : "outline"}
            size="sm"
            onClick={handleMaintenanceToggle}
            disabled={maintenanceMutation.isPending}
          >
            <Wrench className="mr-2 h-4 w-4" />
            {maintenanceMutation.isPending
              ? "Updating..."
              : node.maintenanceMode
                ? "Exit Maintenance"
                : "Enter Maintenance"}
          </Button>
          {node.nodeTokenHash && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRevoke}
              disabled={revokeMutation.isPending}
            >
              <ShieldOff className="mr-2 h-4 w-4" />
              {revokeMutation.isPending ? "Revoking..." : "Revoke Token"}
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {deleteMutation.isPending ? "Deleting..." : "Delete Node"}
          </Button>
        </div>
      </div>

      {node.maintenanceMode && (
        <div className="flex items-center gap-3 rounded-lg border border-orange-500/50 bg-orange-50 px-4 py-3 dark:bg-orange-950/20">
          <Wrench className="h-5 w-5 text-orange-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
              This node is in maintenance mode
            </p>
            <p className="text-xs text-orange-600 dark:text-orange-400">
              All pipelines are stopped. They will automatically resume when maintenance mode is turned off.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleMaintenanceToggle}
            disabled={maintenanceMutation.isPending}
          >
            Exit Maintenance
          </Button>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-4">
            {/* Node Details */}
            <Card>
              <CardHeader>
                <CardTitle>Node Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <div className="flex items-center gap-2">
                      <StatusBadge variant={nodeStatusVariant(node.status)}>
                        {nodeStatusLabel(node.status)}
                      </StatusBadge>
                      {node.currentStatusSince && (
                        <span className="text-xs text-muted-foreground">
                          for {formatLastSeen(node.currentStatusSince)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Environment</p>
                    <p className="text-sm font-medium">{node.environment.name}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Agent Version</p>
                    <p className="text-sm font-mono">{node.agentVersion ?? "\u2014"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Vector Version</p>
                    <p className="text-sm font-mono">{node.vectorVersion ?? "Unknown"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Last Heartbeat</p>
                    <p className="text-sm">{formatLastSeen(node.lastHeartbeat)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Enrolled</p>
                    <p className="text-sm">{node.enrolledAt ? formatLastSeen(node.enrolledAt) : "Not enrolled"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Host</p>
                    <p className="text-sm font-mono">{node.host}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">API Port</p>
                    <p className="text-sm font-mono">{node.apiPort}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Last Seen</p>
                    <p className="text-sm">{formatLastSeen(node.lastSeen)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Created</p>
                    <p className="text-sm">
                      {new Date(node.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Node Labels */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Tag className="h-5 w-5" />
                    Labels
                  </span>
                  {!isEditingLabels && (
                    <Button variant="outline" size="sm" onClick={handleStartEditLabels}>
                      <Pencil className="mr-1 h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isEditingLabels ? (
                  <div className="space-y-3">
                    {editLabels.map((label, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <Input
                          placeholder="Key"
                          value={label.key}
                          onChange={(e) => {
                            const next = [...editLabels];
                            next[idx] = { ...next[idx], key: e.target.value };
                            setEditLabels(next);
                          }}
                          className="flex-1"
                        />
                        <span className="text-muted-foreground">=</span>
                        <Input
                          placeholder="Value"
                          value={label.value}
                          onChange={(e) => {
                            const next = [...editLabels];
                            next[idx] = { ...next[idx], value: e.target.value };
                            setEditLabels(next);
                          }}
                          className="flex-1"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => {
                            setEditLabels(editLabels.filter((_, i) => i !== idx));
                          }}
                          aria-label="Remove label"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditLabels([...editLabels, { key: "", value: "" }])}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      Add Label
                    </Button>
                    <div className="flex items-center gap-2 pt-2">
                      <Button size="sm" onClick={handleSaveLabels} disabled={labelsMutation.isPending}>
                        {labelsMutation.isPending ? "Saving..." : "Save Labels"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setIsEditingLabels(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries((node.labels as Record<string, string>) ?? {}).length > 0 ? (
                      Object.entries((node.labels as Record<string, string>) ?? {}).map(
                        ([k, v]) => (
                          <Badge key={k} variant="outline">
                            {k}={v}
                          </Badge>
                        ),
                      )
                    ) : (
                      <p className="text-sm text-muted-foreground">No labels assigned</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Pipeline Metrics */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Pipeline Metrics
                </CardTitle>
              </CardHeader>
              <CardContent>
                {node.pipelineStatuses && node.pipelineStatuses.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pipeline</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Events In</TableHead>
                        <TableHead className="text-right">Events Out</TableHead>
                        <TableHead className="text-right">Errors</TableHead>
                        <TableHead className="text-right">Bytes In</TableHead>
                        <TableHead className="text-right">Bytes Out</TableHead>
                        <TableHead className="text-right">Avg Latency</TableHead>
                        <TableHead className="text-right">Uptime</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {node.pipelineStatuses.map((ps) => {
                        const rates = pipelineRates[ps.pipelineId];
                        return (
                        <TableRow key={ps.pipelineId}>
                          <TableCell className="font-medium">
                            {ps.pipeline?.name ?? ps.pipelineId.slice(0, 8)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge variant={pipelineStatusVariant(ps.status)}>
                              {pipelineStatusLabel(ps.status)}
                            </StatusBadge>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm tabular-nums">
                            <div>{formatCount(ps.eventsIn)}</div>
                            {rates && <div className="text-xs text-muted-foreground">{formatRate(rates.eventsInRate)}</div>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm tabular-nums">
                            <div>{formatCount(ps.eventsOut)}</div>
                            {rates && <div className="text-xs text-muted-foreground">{formatRate(rates.eventsOutRate)}</div>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm tabular-nums">
                            <div>{formatCount(ps.errorsTotal)}</div>
                            {rates && rates.errorsRate > 0 && <div className="text-xs text-red-500">{formatRate(rates.errorsRate)}</div>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm tabular-nums">
                            <div>{formatBytes(ps.bytesIn)}</div>
                            {rates && <div className="text-xs text-muted-foreground">{formatBytesRate(rates.bytesInRate)}</div>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm tabular-nums">
                            <div>{formatBytes(ps.bytesOut)}</div>
                            {rates && <div className="text-xs text-muted-foreground">{formatBytesRate(rates.bytesOutRate)}</div>}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm tabular-nums">
                            {rates?.latencyMeanMs != null
                              ? formatLatency(rates.latencyMeanMs)
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm tabular-nums">
                            {formatUptime(ps.uptimeSeconds)}
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState
                    title="No pipeline metrics yet"
                    description="Metrics appear after pipelines are deployed and the agent reports heartbeats."
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="health">
          <div className="space-y-6">
            <UptimeCards nodeId={params.nodeId} />
            <StatusTimeline nodeId={params.nodeId} range={timelineRange} onRangeChange={setTimelineRange} />
            <Card>
              <CardHeader>
                <CardTitle>Event Log</CardTitle>
              </CardHeader>
              <CardContent>
                <EventLog nodeId={params.nodeId} range={timelineRange} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="metrics">
          <NodeMetricsCharts nodeId={params.nodeId} />
        </TabsContent>

        <TabsContent value="logs">
          <NodeLogs
            nodeId={params.nodeId}
            pipelines={
              node.pipelineStatuses?.map((ps) => ({
                id: ps.pipelineId,
                name: ps.pipeline?.name ?? ps.pipelineId.slice(0, 8),
              })) ?? []
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
