"use client";

import {
  Workflow,
  Server,
  Layers,
  Activity,
  Clock,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  RUNNING: { icon: CheckCircle, color: "text-green-500", label: "Running" },
  STARTING: { icon: Loader2, color: "text-yellow-500", label: "Starting" },
  STOPPED: { icon: XCircle, color: "text-muted-foreground", label: "Stopped" },
  CRASHED: { icon: AlertTriangle, color: "text-red-500", label: "Crashed" },
  PENDING: { icon: Clock, color: "text-blue-500", label: "Pending" },
};

function formatRelativeTime(date: string | Date | null): string {
  if (!date) return "Never";
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatNumber(n: number | bigint | null | undefined): string {
  if (n == null) return "0";
  const num = typeof n === "bigint" ? Number(n) : n;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

export default function DashboardPage() {
  const trpc = useTRPC();
  const stats = useQuery(trpc.dashboard.stats.queryOptions());
  const ops = useQuery({
    ...trpc.dashboard.operationalOverview.queryOptions(),
    refetchInterval: 15_000,
  });
  const recentPipelines = useQuery(trpc.dashboard.recentPipelines.queryOptions());
  const recentAudit = useQuery(trpc.dashboard.recentAudit.queryOptions());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">Operational overview of your VectorFlow platform</p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/pipelines/new">New Pipeline</Link>
          </Button>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pipelines</CardTitle>
            <Workflow className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.data?.pipelines ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fleet Nodes</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.data?.nodes ?? 0}</div>
            {stats.data && (
              <div className="flex gap-2 mt-1">
                {stats.data.fleet.healthy > 0 && (
                  <Badge variant="outline" className="text-green-600 border-green-600">
                    {stats.data.fleet.healthy} healthy
                  </Badge>
                )}
                {stats.data.fleet.degraded > 0 && (
                  <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                    {stats.data.fleet.degraded} degraded
                  </Badge>
                )}
                {stats.data.fleet.unreachable > 0 && (
                  <Badge variant="outline" className="text-red-600 border-red-600">
                    {stats.data.fleet.unreachable} down
                  </Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Environments</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.data?.environments ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fleet Health</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.data && stats.data.nodes > 0
                ? `${Math.round((stats.data.fleet.healthy / stats.data.nodes) * 100)}%`
                : "\u2014"}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Throughput summary */}
      {ops.data?.recentMetrics && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Events In (5m)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(ops.data.recentMetrics.eventsIn)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Events Out (5m)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatNumber(ops.data.recentMetrics.eventsOut)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Errors (5m)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">{formatNumber(ops.data.recentMetrics.errorsTotal)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Deployed Pipelines Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Workflow className="h-4 w-4" />
              Deployed Pipelines
            </CardTitle>
            <CardDescription>Live pipeline status across all environments</CardDescription>
          </CardHeader>
          <CardContent>
            {ops.data?.deployedPipelines?.length === 0 && (
              <p className="text-sm text-muted-foreground">No deployed pipelines.</p>
            )}
            <div className="space-y-2">
              {ops.data?.deployedPipelines?.map((p: any) => {
                const statuses = p.nodeStatuses ?? [];
                const crashed = statuses.filter((s: any) => s.status === "CRASHED").length;
                const running = statuses.filter((s: any) => s.status === "RUNNING").length;
                const overallStatus = crashed > 0 ? "CRASHED" : running > 0 ? "RUNNING" : statuses.length > 0 ? statuses[0].status : "PENDING";
                const config = statusConfig[overallStatus] ?? statusConfig.PENDING;
                const StatusIcon = config.icon;

                return (
                  <Link
                    key={p.id}
                    href={`/pipelines/${p.id}`}
                    className="flex items-center justify-between rounded-md border p-3 hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <StatusIcon className={`h-4 w-4 ${config.color} ${overallStatus === "STARTING" ? "animate-spin" : ""}`} />
                      <div>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{p.environment?.name}</div>
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      {statuses.length > 0 && (
                        <span>{running}/{statuses.length} nodes</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Unhealthy Nodes */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Issues
            </CardTitle>
            <CardDescription>Nodes requiring attention</CardDescription>
          </CardHeader>
          <CardContent>
            {ops.data?.unhealthyNodes?.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 text-green-500" />
                All nodes healthy
              </div>
            )}
            <div className="space-y-2">
              {ops.data?.unhealthyNodes?.map((node: any) => (
                <Link
                  key={node.id}
                  href={`/fleet/${node.id}`}
                  className="flex items-center justify-between rounded-md border p-3 hover:bg-accent transition-colors"
                >
                  <div>
                    <div className="font-medium">{node.name || node.hostname}</div>
                    <div className="text-xs text-muted-foreground">{node.environment?.name}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        node.status === "UNREACHABLE"
                          ? "text-red-600 border-red-600"
                          : node.status === "DEGRADED"
                            ? "text-yellow-600 border-yellow-600"
                            : "text-gray-600 border-gray-600"
                      }
                    >
                      {node.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(node.lastSeenAt)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent pipelines */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Recent Pipelines
            </CardTitle>
            <CardDescription>Last modified pipelines</CardDescription>
          </CardHeader>
          <CardContent>
            {recentPipelines.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">No pipelines yet.</p>
            )}
            <div className="space-y-2">
              {recentPipelines.data?.map((p: any) => (
                <Link
                  key={p.id}
                  href={`/pipelines/${p.id}`}
                  className="flex items-center justify-between rounded-md border p-3 hover:bg-accent transition-colors"
                >
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.environment?.name}</div>
                  </div>
                  <Badge variant={p.isDraft ? "secondary" : "default"}>
                    {p.isDraft ? "Draft" : "Deployed"}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent audit */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Recent Activity
            </CardTitle>
            <CardDescription>Latest audit log entries</CardDescription>
          </CardHeader>
          <CardContent>
            {recentAudit.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
            <div className="space-y-2">
              {recentAudit.data?.map((entry: any) => (
                <div key={entry.id} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">{entry.action}</div>
                    <div className="text-xs text-muted-foreground">
                      {entry.user?.name ?? entry.user?.email} — {entry.entityType}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
