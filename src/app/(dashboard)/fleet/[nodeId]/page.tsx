"use client";

import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { ArrowLeft, Save, ShieldOff, Trash2, Activity, Terminal, Server } from "lucide-react";
import { NodeLogs } from "@/components/fleet/node-logs";
import { toast } from "sonner";
import { useState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Separator } from "@/components/ui/separator";
import { NodeMetricsCharts } from "@/components/fleet/node-metrics-charts";
import type { NodeStatus } from "@/generated/prisma";

const statusColors: Record<NodeStatus, string> = {
  HEALTHY: "bg-green-500/15 text-green-700 dark:text-green-400",
  DEGRADED: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  UNREACHABLE: "bg-red-500/15 text-red-700 dark:text-red-400",
  UNKNOWN: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

function formatLastSeen(date: Date | string | null): string {
  if (!date) return "Never";
  const d = new Date(date);
  return d.toLocaleString();
}

function formatCount(n: number | bigint | null): string {
  const v = Number(n ?? 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function formatBytes(n: number | bigint | null): string {
  const v = Number(n ?? 0);
  if (v >= 1_073_741_824) return `${(v / 1_073_741_824).toFixed(1)} GB`;
  if (v >= 1_048_576) return `${(v / 1_048_576).toFixed(1)} MB`;
  if (v >= 1_024) return `${(v / 1_024).toFixed(1)} KB`;
  return `${v} B`;
}

function formatUptime(seconds: number | null): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const pipelineStatusColors: Record<string, string> = {
  RUNNING: "bg-green-500/15 text-green-700 dark:text-green-400",
  STARTING: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  STOPPED: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
  CRASHED: "bg-red-500/15 text-red-700 dark:text-red-400",
  PENDING: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
};

export default function NodeDetailPage() {
  const params = useParams<{ nodeId: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [editName, setEditName] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const nodeQuery = useQuery(
    trpc.fleet.get.queryOptions(
      { id: params.nodeId },
      { refetchInterval: 15_000 },
    )
  );

  const node = nodeQuery.data;

  useEffect(() => {
    if (node) {
      setEditName(node.name);
    }
  }, [node]);

  useEffect(() => {
    if (node) {
      setIsDirty(editName !== node.name);
    }
  }, [editName, node]);

  const updateMutation = useMutation(
    trpc.fleet.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.fleet.get.queryKey({ id: params.nodeId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.fleet.list.queryKey(),
        });
        setIsDirty(false);
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

  function handleRevoke() {
    if (!node) return;
    if (!confirm(`Revoke token for "${node.name}"? The agent will no longer be able to connect.`)) {
      return;
    }
    revokeMutation.mutate({ id: node.id });
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!node) return;
    updateMutation.mutate({
      id: node.id,
      name: editName,
    });
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
        <Button variant="ghost" onClick={() => router.push("/fleet")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Fleet
        </Button>
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">Node not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push("/fleet")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{node.name}</h2>
            <p className="text-muted-foreground">
              {node.host}:{node.apiPort}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="grid gap-6 md:grid-cols-2">
        {/* Node Details */}
        <Card>
          <CardHeader>
            <CardTitle>Node Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge
                  variant="outline"
                  className={statusColors[node.status as NodeStatus]}
                >
                  {node.status}
                </Badge>
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

        {/* Rename Node */}
        <Card>
          <CardHeader>
            <CardTitle>Rename Node</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              </div>
              <Button
                type="submit"
                disabled={!isDirty || updateMutation.isPending}
                className="w-full"
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* System Resources */}
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Server className="h-5 w-5" />
          System Resources
        </h3>
        <NodeMetricsCharts nodeId={params.nodeId} />
      </div>

      <Separator />

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
                  <TableHead className="text-right">Uptime</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {node.pipelineStatuses.map((ps) => (
                  <TableRow key={ps.pipelineId}>
                    <TableCell className="font-medium">
                      {ps.pipeline?.name ?? ps.pipelineId.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={pipelineStatusColors[ps.status] ?? ""}
                      >
                        {ps.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCount(ps.eventsIn)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCount(ps.eventsOut)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCount(ps.errorsTotal)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatBytes(ps.bytesIn)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatBytes(ps.bytesOut)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatUptime(ps.uptimeSeconds)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
              <p className="text-muted-foreground">
                No pipeline metrics yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Metrics appear after pipelines are deployed and the agent reports heartbeats.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Logs */}
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Terminal className="h-5 w-5" />
          Logs
        </h3>
        <NodeLogs
          nodeId={params.nodeId}
          pipelines={
            node.pipelineStatuses?.map((ps) => ({
              id: ps.pipelineId,
              name: ps.pipeline?.name ?? ps.pipelineId.slice(0, 8),
            })) ?? []
          }
        />
      </div>
    </div>
  );
}
