"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import Link from "next/link";
import { ShieldOff, Trash2, Wrench, Tag, Pencil, X, Plus, Activity, Database } from "lucide-react";
import { NodeLogs } from "@/components/fleet/node-logs";
import { toast } from "sonner";
import { useState } from "react";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import { useTeamStore } from "@/stores/team-store";

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
import { ErrorState } from "@/components/ui/error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PageHeader, PageHeaderMetaSep } from "@/components/ui/page-header";
import { KpiInStrip, KpiStrip } from "@/components/ui/kpi-tile";
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

  const [isEditingLabels, setIsEditingLabels] = useState(false);
  const [editLabels, setEditLabels] = useState<Array<{ key: string; value: string }>>([]);
  const [timelineRange, setTimelineRange] = useState<"1h" | "6h" | "1d" | "7d" | "30d">("1d");
  const [confirmAction, setConfirmAction] = useState<"enter-maintenance" | "exit-maintenance" | "revoke" | "delete" | null>(null);

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

  // Lake glue: surface a "search in Lake" link for pipelines that have a lake
  // dataset, stitching Fleet (telemetry) → Lake (event history).
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const lakeStatusQuery = useQuery(trpc.lake.status.queryOptions());
  const lakeDatasetsQuery = useQuery({
    ...trpc.lake.listDatasets.queryOptions({ teamId: selectedTeamId ?? "" }),
    enabled: !!selectedTeamId && (lakeStatusQuery.data?.enabled ?? false),
  });
  const lakePipelineIds = new Set((lakeDatasetsQuery.data ?? []).map((d) => d.pipelineId));


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
    setConfirmAction(node.maintenanceMode ? "exit-maintenance" : "enter-maintenance");
  }

  function handleRevoke() {
    if (!node) return;
    setConfirmAction("revoke");
  }

  function handleDelete() {
    if (!node) return;
    setConfirmAction("delete");
  }

  function handleConfirmAction() {
    if (!node || !confirmAction) return;
    if (confirmAction === "enter-maintenance" || confirmAction === "exit-maintenance") {
      maintenanceMutation.mutate(
        { nodeId: node.id, enabled: confirmAction === "enter-maintenance" },
        { onSuccess: () => setConfirmAction(null) },
      );
      return;
    }
    if (confirmAction === "revoke") {
      revokeMutation.mutate({ id: node.id }, { onSuccess: () => setConfirmAction(null) });
      return;
    }
    deleteMutation.mutate({ id: node.id }, { onSuccess: () => setConfirmAction(null) });
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
      <div className="min-h-full bg-bg">
        <ErrorState
          title="Node not found"
          body="The requested fleet node could not be loaded. Return to the fleet list or retry this route."
          primary={{ label: "Retry", onClick: () => nodeQuery.refetch() }}
          secondary={[{ label: "Back to fleet", onClick: () => router.push("/fleet") }]}
        />
      </div>
    );
  }

  const runningCount = node.pipelineStatuses.filter((s) => s.status === "RUNNING").length;
  const totalEventsIn = node.pipelineStatuses.reduce((sum, s) => sum + Number(s.eventsIn ?? 0), 0);
  const totalEventsOut = node.pipelineStatuses.reduce((sum, s) => sum + Number(s.eventsOut ?? 0), 0);
  const totalErrors = node.pipelineStatuses.reduce((sum, s) => sum + Number(s.errorsTotal ?? 0), 0);
  const avgLatency = Object.values(pipelineRates).filter((rate) => rate.latencyMeanMs != null);
  const meanLatencyMs = avgLatency.length
    ? avgLatency.reduce((sum, rate) => sum + (rate.latencyMeanMs ?? 0), 0) / avgLatency.length
    : null;
  const confirmCopy = getConfirmCopy(confirmAction, node.name, runningCount);
  const confirmPending =
    maintenanceMutation.isPending || revokeMutation.isPending || deleteMutation.isPending;


  return (
    <div className="min-h-full bg-bg">
      <PageHeader
        title={
          <span className="inline-flex items-baseline gap-2">
            <Link href="/fleet" className="text-[13px] font-normal text-fg-1 hover:text-fg">
              Fleet /
            </Link>
            <span>{node.name}</span>
          </span>
        }
        subtitle={<span className="font-mono">{node.host}:{node.apiPort} · {node.environment.name}</span>}
        meta={
          <>
            <span>{nodeStatusLabel(node.status)}</span>
            <PageHeaderMetaSep />
            <span>vector {node.vectorVersion ?? "unknown"}</span>
            <PageHeaderMetaSep />
            <span>agent {node.agentVersion ?? "unknown"}</span>
            <PageHeaderMetaSep />
            <span>uptime —</span>
          </>
        }
        actions={
          <>
            <Button
              variant={node.maintenanceMode ? "default" : "outline"}
              size="sm"
              onClick={handleMaintenanceToggle}
              disabled={maintenanceMutation.isPending}
            >
              <Wrench className="h-3.5 w-3.5" />
              {maintenanceMutation.isPending
                ? "Updating"
                : node.maintenanceMode
                  ? "Exit maintenance"
                  : "Maintenance"}
            </Button>
            {node.nodeTokenHash && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRevoke}
                disabled={revokeMutation.isPending}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                {revokeMutation.isPending ? "Revoking" : "Revoke token"}
              </Button>
            )}
            <Button
              variant="danger"
              size="sm"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleteMutation.isPending ? "Deleting" : "Delete node"}
            </Button>
          </>
        }
      />

      <div className="space-y-4 p-4">
        {node.status === "UNREACHABLE" && (
          <ErrorState
            title={`${node.name} disconnected`}
            statusLabel={`${nodeStatusLabel(node.status)}${node.currentStatusSince ? ` · ${formatLastSeen(node.currentStatusSince)}` : ""}`}
            body={
              <>
                Lost heartbeat from <span className="font-mono text-fg">{node.host}</span>.{" "}
                {runningCount > 0
                  ? `${runningCount} pipeline${runningCount === 1 ? "" : "s"} are assigned to this node.`
                  : "No running pipelines are assigned to this node."}
              </>
            }
            diagnostics={[
              { label: "last contact", value: formatLastSeen(node.lastHeartbeat) },
              { label: "host", value: `${node.host}:${node.apiPort}` },
              { label: "environment", value: node.environment.name },
              { label: "pipelines affected", value: runningCount, accent: runningCount > 0 },
            ]}
            trySteps={[
              <>Check the host directly: <span className="font-mono text-fg">ssh ops@{node.host}</span></>,
              <>Confirm the agent process: <span className="font-mono text-fg">systemctl status vectorflow-agent</span></>,
              "If decommissioning, delete the node to stop the alert.",
            ]}
            secondary={[
              {
                label: node.maintenanceMode ? "Exit maintenance" : "Maintenance",
                onClick: handleMaintenanceToggle,
                icon: <Wrench className="h-3.5 w-3.5" />,
              },
              {
                label: "Delete node",
                onClick: handleDelete,
                icon: <Trash2 className="h-3.5 w-3.5" />,
              },
            ]}
          />
        )}

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

        <Card className="overflow-hidden border-line bg-bg-2">
          <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
            <CardTitle className="font-mono text-[12px] uppercase tracking-[0.06em]">
              Resource live surface
            </CardTitle>
          </CardHeader>
          <KpiStrip className="grid grid-cols-2 md:grid-cols-4">
            <KpiInStrip label="running" value={`${runningCount}/${node.pipelineStatuses.length}`} sub="assigned pipelines" />
            <KpiInStrip label="events in" value={formatCount(totalEventsIn)} sub="node lifetime" />
            <KpiInStrip label="events out" value={formatCount(totalEventsOut)} sub="node lifetime" />
            <KpiInStrip label="errors" value={formatCount(totalErrors)} sub="node lifetime" accent={totalErrors > 0 ? "var(--error)" : undefined} />
          </KpiStrip>
          <CardContent className="space-y-3 p-4">
            <div className="grid gap-3 rounded-[3px] border border-line bg-bg p-3 font-mono text-[11px] text-fg-2 md:grid-cols-3">
              <div>host · <span className="text-fg">{node.host}:{node.apiPort}</span></div>
              <div>load latency · <span className="text-fg">{meanLatencyMs == null ? "—" : formatLatency(meanLatencyMs)}</span></div>
              <div>last heartbeat · <span className="text-fg">{formatLastSeen(node.lastHeartbeat)}</span></div>
            </div>
            <NodeMetricsCharts nodeId={params.nodeId} />
          </CardContent>
        </Card>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
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
                    <p className="text-sm font-mono tabular-nums">{node.agentVersion ?? "\u2014"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Vector Version</p>
                    <p className="text-sm font-mono tabular-nums">{node.vectorVersion ?? "Unknown"}</p>
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
                    <p className="text-sm font-mono tabular-nums">{node.host}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">API Port</p>
                    <p className="text-sm font-mono tabular-nums">{node.apiPort}</p>
                  </div>
                  {node.runningUser && (
                    <div>
                      <p className="text-sm text-muted-foreground">Running As</p>
                      <p className="text-sm font-mono tabular-nums">{node.runningUser}</p>
                    </div>
                  )}
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
                            <span className="flex items-center gap-2">
                              {ps.pipeline?.name ?? ps.pipelineId.slice(0, 8)}
                              {lakePipelineIds.has(ps.pipelineId) && (
                                <Button
                                  asChild
                                  size="icon-xs"
                                  variant="ghost"
                                  aria-label="Search this pipeline in Lake"
                                  title="Search this pipeline in Lake"
                                >
                                  <Link href={`/lake?pipelineId=${ps.pipelineId}`}>
                                    <Database className="h-3 w-3" />
                                  </Link>
                                </Button>
                              )}
                            </span>
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

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmCopy.title}
        description={confirmCopy.description}
        confirmLabel={confirmCopy.confirmLabel}
        pendingLabel={confirmCopy.pendingLabel}
        variant={confirmCopy.variant}
        isPending={confirmPending}
        onConfirm={handleConfirmAction}
      />
      </div>
    </div>
  );
}

type ConfirmAction = "enter-maintenance" | "exit-maintenance" | "revoke" | "delete" | null;

function getConfirmCopy(action: ConfirmAction, nodeName: string, runningCount: number) {
  switch (action) {
    case "enter-maintenance":
      return {
        title: "Enter maintenance mode?",
        description: (
          <>
            This will stop {runningCount} running pipeline{runningCount === 1 ? "" : "s"} on
            &quot;{nodeName}&quot;. Pipelines will automatically resume when maintenance mode is turned off.
          </>
        ),
        confirmLabel: "Enter Maintenance",
        pendingLabel: "Entering...",
        variant: "default" as const,
      };
    case "exit-maintenance":
      return {
        title: "Exit maintenance mode?",
        description: <>Pipelines assigned to &quot;{nodeName}&quot; will be allowed to resume.</>,
        confirmLabel: "Exit Maintenance",
        pendingLabel: "Exiting...",
        variant: "default" as const,
      };
    case "revoke":
      return {
        title: "Revoke node token?",
        description: <>The agent for &quot;{nodeName}&quot; will no longer be able to connect until re-enrolled.</>,
        confirmLabel: "Revoke Token",
        pendingLabel: "Revoking...",
        variant: "destructive" as const,
      };
    case "delete":
      return {
        title: "Delete node?",
        description: <>Delete &quot;{nodeName}&quot; and its node state. This action cannot be undone.</>,
        confirmLabel: "Delete Node",
        pendingLabel: "Deleting...",
        variant: "destructive" as const,
      };
    default:
      return {
        title: "Confirm action",
        description: "Confirm this node action.",
        confirmLabel: "Confirm",
        pendingLabel: "Working...",
        variant: "default" as const,
      };
  }
}
