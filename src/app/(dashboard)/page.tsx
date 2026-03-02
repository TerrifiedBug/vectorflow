"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Search, Server, Activity, GitBranch, BarChart3 } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { NodeCard } from "@/components/dashboard/node-card";
import { PipelineCard } from "@/components/dashboard/pipeline-card";

/** Derive an overall status for a pipeline from its node statuses */
function derivePipelineStatus(
  nodes: Array<{ pipelineStatus: string }>
): string {
  if (nodes.length === 0) return "PENDING";
  if (nodes.some((n) => n.pipelineStatus === "CRASHED")) return "CRASHED";
  if (nodes.some((n) => n.pipelineStatus === "RUNNING")) return "RUNNING";
  if (nodes.some((n) => n.pipelineStatus === "STARTING")) return "STARTING";
  if (nodes.every((n) => n.pipelineStatus === "STOPPED")) return "STOPPED";
  return nodes[0].pipelineStatus;
}

export default function DashboardPage() {
  const trpc = useTRPC();

  const stats = useQuery(trpc.dashboard.stats.queryOptions());
  const nodeCards = useQuery({
    ...trpc.dashboard.nodeCards.queryOptions(),
    refetchInterval: 15_000,
  });
  const pipelineCards = useQuery({
    ...trpc.dashboard.pipelineCards.queryOptions(),
    refetchInterval: 15_000,
  });

  const [nodeSearch, setNodeSearch] = useState("");
  const [pipelineSearch, setPipelineSearch] = useState("");
  const [nodeStatusFilter, setNodeStatusFilter] = useState<string | null>(null);
  const [pipelineStatusFilter, setPipelineStatusFilter] = useState<string | null>(null);

  // Compute pipeline status counts for summary bar
  const pipelineStatusCounts = useMemo(() => {
    if (!pipelineCards.data) return { running: 0, stopped: 0, crashed: 0 };
    let running = 0;
    let stopped = 0;
    let crashed = 0;
    for (const p of pipelineCards.data) {
      const status = derivePipelineStatus(p.nodes);
      if (status === "RUNNING" || status === "STARTING") running++;
      else if (status === "STOPPED") stopped++;
      else if (status === "CRASHED") crashed++;
    }
    return { running, stopped, crashed };
  }, [pipelineCards.data]);

  // Filter nodes
  const filteredNodes = useMemo(() => {
    if (!nodeCards.data) return [];
    return nodeCards.data.filter((node) => {
      if (nodeStatusFilter && node.status !== nodeStatusFilter) return false;
      if (nodeSearch) {
        const term = nodeSearch.toLowerCase();
        return (
          node.name.toLowerCase().includes(term) ||
          node.host.toLowerCase().includes(term)
        );
      }
      return true;
    });
  }, [nodeCards.data, nodeSearch, nodeStatusFilter]);

  // Filter pipelines
  const filteredPipelines = useMemo(() => {
    if (!pipelineCards.data) return [];
    return pipelineCards.data.filter((pipeline) => {
      if (pipelineStatusFilter) {
        const status = derivePipelineStatus(pipeline.nodes);
        if (status !== pipelineStatusFilter) return false;
      }
      if (pipelineSearch) {
        const term = pipelineSearch.toLowerCase();
        return pipeline.name.toLowerCase().includes(term);
      }
      return true;
    });
  }, [pipelineCards.data, pipelineSearch, pipelineStatusFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Operational overview of your VectorFlow platform
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/pipelines/new">New Pipeline</Link>
          </Button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Total Nodes */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Total Nodes</p>
              <Server className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-1 text-2xl font-bold">{stats.data?.nodes ?? 0}</p>
          </CardContent>
        </Card>

        {/* Node Health */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Node Health</p>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {stats.data?.fleet.healthy != null && stats.data.fleet.healthy > 0 && (
                <StatusBadge variant="healthy">{stats.data.fleet.healthy} Healthy</StatusBadge>
              )}
              {stats.data?.fleet.degraded != null && stats.data.fleet.degraded > 0 && (
                <StatusBadge variant="degraded">{stats.data.fleet.degraded} Degraded</StatusBadge>
              )}
              {stats.data?.fleet.unreachable != null && stats.data.fleet.unreachable > 0 && (
                <StatusBadge variant="error">{stats.data.fleet.unreachable} Unreachable</StatusBadge>
              )}
              {stats.data && stats.data.nodes === 0 && (
                <span className="text-sm text-muted-foreground">No nodes</span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Total Pipelines */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Pipelines</p>
              <GitBranch className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="mt-1 text-2xl font-bold">{stats.data?.pipelines ?? 0}</p>
          </CardContent>
        </Card>

        {/* Pipeline Status */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Pipeline Status</p>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {pipelineStatusCounts.running > 0 && (
                <StatusBadge variant="healthy">{pipelineStatusCounts.running} Running</StatusBadge>
              )}
              {pipelineStatusCounts.stopped > 0 && (
                <StatusBadge variant="neutral">{pipelineStatusCounts.stopped} Stopped</StatusBadge>
              )}
              {pipelineStatusCounts.crashed > 0 && (
                <StatusBadge variant="error">{pipelineStatusCounts.crashed} Crashed</StatusBadge>
              )}
              {stats.data && stats.data.pipelines === 0 && (
                <span className="text-sm text-muted-foreground">No pipelines</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabbed content */}
      <Tabs defaultValue="nodes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="nodes">
            Nodes{stats.data && stats.data.nodes > 0 ? ` (${stats.data.nodes})` : ""}
          </TabsTrigger>
          <TabsTrigger value="pipelines">
            Pipelines{stats.data && stats.data.pipelines > 0 ? ` (${stats.data.pipelines})` : ""}
          </TabsTrigger>
        </TabsList>

        {/* Nodes tab */}
        <TabsContent value="nodes" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search nodes..."
                value={nodeSearch}
                onChange={(e) => setNodeSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant={nodeStatusFilter === null ? "default" : "outline"}
                size="sm"
                onClick={() => setNodeStatusFilter(null)}
              >
                All
              </Button>
              <Button
                variant={nodeStatusFilter === "HEALTHY" ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  setNodeStatusFilter(
                    nodeStatusFilter === "HEALTHY" ? null : "HEALTHY"
                  )
                }
              >
                Healthy
              </Button>
              <Button
                variant={
                  nodeStatusFilter === "DEGRADED" ? "default" : "outline"
                }
                size="sm"
                onClick={() =>
                  setNodeStatusFilter(
                    nodeStatusFilter === "DEGRADED" ? null : "DEGRADED"
                  )
                }
              >
                Degraded
              </Button>
              <Button
                variant={
                  nodeStatusFilter === "UNREACHABLE" ? "default" : "outline"
                }
                size="sm"
                onClick={() =>
                  setNodeStatusFilter(
                    nodeStatusFilter === "UNREACHABLE" ? null : "UNREACHABLE"
                  )
                }
              >
                Unreachable
              </Button>
            </div>
          </div>

          {nodeCards.isLoading && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-lg" />
              ))}
            </div>
          )}

          {nodeCards.data && filteredNodes.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
              <Server className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium">
                {nodeSearch || nodeStatusFilter ? "No nodes match the current filter" : "No nodes registered yet"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {nodeSearch || nodeStatusFilter
                  ? "Try adjusting your search or filter criteria."
                  : "Deploy a VectorFlow agent to register your first node."}
              </p>
            </div>
          )}

          {filteredNodes.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredNodes.map((node) => (
                <NodeCard key={node.id} node={node} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Pipelines tab */}
        <TabsContent value="pipelines" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search pipelines..."
                value={pipelineSearch}
                onChange={(e) => setPipelineSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant={pipelineStatusFilter === null ? "default" : "outline"}
                size="sm"
                onClick={() => setPipelineStatusFilter(null)}
              >
                All
              </Button>
              <Button
                variant={
                  pipelineStatusFilter === "RUNNING" ? "default" : "outline"
                }
                size="sm"
                onClick={() =>
                  setPipelineStatusFilter(
                    pipelineStatusFilter === "RUNNING" ? null : "RUNNING"
                  )
                }
              >
                Running
              </Button>
              <Button
                variant={
                  pipelineStatusFilter === "STOPPED" ? "default" : "outline"
                }
                size="sm"
                onClick={() =>
                  setPipelineStatusFilter(
                    pipelineStatusFilter === "STOPPED" ? null : "STOPPED"
                  )
                }
              >
                Stopped
              </Button>
              <Button
                variant={
                  pipelineStatusFilter === "CRASHED" ? "default" : "outline"
                }
                size="sm"
                onClick={() =>
                  setPipelineStatusFilter(
                    pipelineStatusFilter === "CRASHED" ? null : "CRASHED"
                  )
                }
              >
                Crashed
              </Button>
            </div>
          </div>

          {pipelineCards.isLoading && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-lg" />
              ))}
            </div>
          )}

          {pipelineCards.data && filteredPipelines.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
              <GitBranch className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium">
                {pipelineSearch || pipelineStatusFilter ? "No pipelines match the current filter" : "No deployed pipelines yet"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {pipelineSearch || pipelineStatusFilter
                  ? "Try adjusting your search or filter criteria."
                  : "Create and deploy a pipeline to see it here."}
              </p>
              {!pipelineSearch && !pipelineStatusFilter && (
                <Button asChild className="mt-4" variant="outline" size="sm">
                  <Link href="/pipelines/new">Create Pipeline</Link>
                </Button>
              )}
            </div>
          )}

          {filteredPipelines.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredPipelines.map((pipeline) => (
                <PipelineCard key={pipeline.id} pipeline={pipeline} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
