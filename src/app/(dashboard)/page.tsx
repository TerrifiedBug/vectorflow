"use client";

import { Workflow, Server, Layers, Activity, Clock, Shield } from "lucide-react";
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

export default function DashboardPage() {
  const trpc = useTRPC();
  const stats = useQuery(trpc.dashboard.stats.queryOptions());
  const recentPipelines = useQuery(trpc.dashboard.recentPipelines.queryOptions());
  const recentAudit = useQuery(trpc.dashboard.recentAudit.queryOptions());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Welcome to VectorFlow</h2>
          <p className="text-muted-foreground">Visual pipeline management for Vector</p>
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
