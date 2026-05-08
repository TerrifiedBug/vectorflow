"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, BarChart3, GitBranch, GitCommit, Layers, Pencil, PlayCircle, ShieldCheck } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { aggregateProcessStatus } from "@/lib/pipeline-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";

function deploymentLabel(pipeline: { isDraft: boolean; deployedAt?: Date | string | null }) {
  return !pipeline.isDraft && pipeline.deployedAt ? "Deployed" : "Draft";
}

function formatDate(value?: Date | string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function formatRelativeSeconds(seconds?: number | null) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}


function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function nodeLabel(node: { displayName?: string | null; componentKey: string }) {
  return node.displayName || node.componentKey;
}

export default function PipelineDetailPage() {
  const params = useParams<{ id: string }>();
  const pipelineId = params.id;
  const trpc = useTRPC();

  const pipelineQuery = useQuery(trpc.pipeline.get.queryOptions({ id: pipelineId }));
  const versionsQuery = useQuery(trpc.pipeline.versionsSummary.queryOptions({ pipelineId }));
  const upstreamsQuery = useQuery(trpc.pipelineDependency.list.queryOptions({ pipelineId }));
  const impactQuery = useQuery(trpc.pipelineDependency.deploymentImpact.queryOptions({ pipelineId }));

  if (pipelineQuery.isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (pipelineQuery.error || !pipelineQuery.data) {
    return (
      <QueryError
        message={`Failed to load pipeline: ${pipelineQuery.error?.message ?? "Pipeline not found"}`}
        onRetry={() => pipelineQuery.refetch()}
      />
    );
  }

  const pipeline = pipelineQuery.data;
  const processStatus = aggregateProcessStatus(pipeline.nodeStatuses);
  const sources = pipeline.nodes.filter((n) => n.kind === "SOURCE").length;
  const transforms = pipeline.nodes.filter((n) => n.kind === "TRANSFORM").length;
  const sinks = pipeline.nodes.filter((n) => n.kind === "SINK").length;
  const status = deploymentLabel(pipeline);

  const runningNodes = pipeline.nodeStatuses.filter((s) => s.status === "RUNNING").length;
  const disabledNodes = pipeline.nodes.filter((n) => n.disabled).length;
  const sharedNodes = pipeline.nodes.filter((n) => n.sharedComponentId).length;
  const tags = stringArray(pipeline.tags);
  const latestVersion = pipeline.versions[0];
  const nodeById = new Map(pipeline.nodes.map((node) => [node.id, node]));
  const versions = versionsQuery.data ?? [];
  const impact = impactQuery.data;
  const dependentTotal = impact?.total ?? 0;
  const deployedDependents = impact?.deployed.length ?? 0;
  const draftDependents = impact?.draft.length ?? 0;
  const longestUptime = Math.max(0, ...pipeline.nodeStatuses.map((s) => s.uptimeSeconds ?? 0));
  const latestActivity = versions[0];

  return (
    <div className="space-y-4 p-6 text-fg">
      <div className="rounded-[3px] border border-line bg-bg-2">
        <div className="flex flex-col gap-4 border-b border-line bg-bg-1 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate font-mono text-[22px] font-medium tracking-[-0.01em]">{pipeline.name}</h1>
              <Pill variant={status === "Deployed" ? "ok" : "status"} size="sm">
                {status}
              </Pill>
              {pipeline.hasConfigChanges && (
                <Pill variant="warn" size="sm">changes pending</Pill>
              )}
              {pipeline.isSystem && <Pill variant="info" size="sm">system</Pill>}
            </div>
            <p className="max-w-3xl text-[12px] leading-relaxed text-fg-1">
              {pipeline.description || "No description provided."}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] uppercase tracking-[0.05em] text-fg-2">
              <span>env · {pipeline.environment.name}</span>
              <span>process · {processStatus?.toLowerCase() ?? "unknown"}</span>
              <span>updated · {formatDate(pipeline.updatedAt)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="h-8 rounded-[3px] gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em]">
              <Link href={`/pipelines/${pipelineId}/metrics`}>
                <BarChart3 className="h-3.5 w-3.5" />
                Metrics
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8 rounded-[3px] gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em]">
              <Link href={`/pipelines/${pipelineId}/scorecard`}>
                <ShieldCheck className="h-3.5 w-3.5" />
                Scorecard
              </Link>
            </Button>
            <Button asChild variant="primary" size="sm" className="h-8 rounded-[3px] gap-1.5 font-mono text-[11px] uppercase tracking-[0.04em]">
              <Link href={`/pipelines/${pipelineId}/edit`}>
                <Pencil className="h-3.5 w-3.5" />
                Edit draft
              </Link>
            </Button>
          </div>
        </div>

        <div className="grid border-b border-line bg-bg lg:grid-cols-6">
          {[
            { label: "process", value: processStatus?.toLowerCase() ?? "unknown", sub: `${runningNodes}/${pipeline.nodeStatuses.length || pipeline.nodes.length} runtime slots` },
            { label: "uptime", value: formatRelativeSeconds(longestUptime), sub: "longest running node" },
            { label: "topology", value: `${sources}/${transforms}/${sinks}`, sub: `${pipeline.edges.length} active routes` },
            { label: "dependencies", value: dependentTotal, sub: `${deployedDependents} deployed impact` },
            { label: "deployed", value: pipeline.deployedVersionNumber ? `v${pipeline.deployedVersionNumber}` : "—", sub: latestVersion?.logLevel ? `log ${latestVersion.logLevel}` : "no release" },
            { label: "draft state", value: pipeline.hasConfigChanges ? "pending" : "clean", sub: pipeline.hasConfigChanges ? "deploy draft to update" : "matches deployed" },
          ].map((item) => (
            <div key={item.label} className="border-b border-line px-4 py-3 last:border-b-0 sm:border-r sm:last:border-r-0 lg:border-b-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-fg-2">{item.label}</div>
              <div className="mt-1 truncate font-mono text-[20px] leading-none text-fg tabular-nums">{item.value}</div>
              <div className="mt-1 truncate text-[11px] text-fg-2">{item.sub}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-line bg-bg-2">
          <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
            <CardTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em]">
              <Activity className="h-4 w-4 text-fg-2" />
              Operational activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 py-3 text-[12px]">
            <div className="flex justify-between gap-3"><span className="text-fg-2">Latest release</span><span className="font-mono">{latestActivity ? `v${latestActivity.version}` : "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-2">Operator</span><span className="max-w-[150px] truncate font-mono text-right">{latestActivity?.createdBy?.name ?? latestActivity?.createdBy?.email ?? "system"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-2">Last deployed</span><span className="font-mono text-right">{formatDate(pipeline.deployedAt)}</span></div>
          </CardContent>
        </Card>

        <Card className="border-line bg-bg-2">
          <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
            <CardTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em]">
              <Layers className="h-4 w-4 text-fg-2" />
              Attached runtime
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 py-3 text-[12px]">
            <div className="flex justify-between gap-3"><span className="text-fg-2">Runtime slots</span><span className="font-mono tabular-nums">{pipeline.nodeStatuses.length || pipeline.nodes.length}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-2">Running</span><span className="font-mono tabular-nums">{runningNodes}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-2">Disabled components</span><span className="font-mono tabular-nums">{disabledNodes}</span></div>
          </CardContent>
        </Card>

        <Card className="border-line bg-bg-2">
          <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
            <CardTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em]">
              <GitBranch className="h-4 w-4 text-fg-2" />
              Dependency impact
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 py-3 text-[12px]">
            <div className="flex justify-between gap-3"><span className="text-fg-2">Downstream</span><span className="font-mono tabular-nums">{dependentTotal}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-2">Deployed impact</span><span className="font-mono tabular-nums">{deployedDependents}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-2">Draft impact</span><span className="font-mono tabular-nums">{draftDependents}</span></div>
          </CardContent>
        </Card>

        <Card className="border-line bg-bg-2">
          <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
            <CardTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em]">
              <PlayCircle className="h-4 w-4 text-fg-2" />
              Value delivery
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 px-4 py-3 text-[12px]">
            <div className="flex justify-between gap-3"><span className="text-fg-2">Flow shape</span><span className="font-mono">{sources}→{transforms}→{sinks}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-2">Shared controls</span><span className="font-mono tabular-nums">{sharedNodes}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-2">Tags</span><span className="font-mono tabular-nums">{tags.length}</span></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
        <Card className="overflow-hidden border-line bg-bg-2">
          <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
            <CardTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em]">
              <Layers className="h-4 w-4 text-fg-2" />
              Component health
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <div className="grid min-w-[620px] border-b border-line bg-bg px-4 py-2 font-mono text-[10px] uppercase tracking-[0.05em] text-fg-2" style={{ gridTemplateColumns: "minmax(160px,1.2fr) 92px minmax(120px,1fr) 92px 92px" }}>
              <span>component</span>
              <span>kind</span>
              <span>type</span>
              <span>placement</span>
              <span>state</span>
            </div>
            <div className="divide-y divide-line">
              {pipeline.nodes.map((node) => (
                <div key={node.id} className="grid min-w-[620px] items-center gap-3 px-4 py-2.5 text-[12px]" style={{ gridTemplateColumns: "minmax(160px,1.2fr) 92px minmax(120px,1fr) 92px 92px" }}>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-fg">{nodeLabel(node)}</div>
                    <div className="truncate font-mono text-[10px] text-fg-2">{node.componentKey}</div>
                  </div>
                  <Pill variant="kind" size="xs">{node.kind.toLowerCase()}</Pill>
                  <span className="truncate font-mono text-[11px] text-fg-1">{node.componentType}</span>
                  <span className="font-mono text-[11px] text-fg-2">{node.sharedComponentId ? "shared" : "local"}</span>
                  <Pill variant={node.disabled ? "warn" : "ok"} size="xs">{node.disabled ? "disabled" : "active"}</Pill>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-line bg-bg-2">
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em]">
                <Activity className="h-4 w-4 text-fg-2" />
                Runtime
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 py-3 text-[12px]">
              <div className="flex justify-between gap-3"><span className="text-fg-2">Aggregate process</span><span className="font-mono capitalize">{processStatus?.toLowerCase() ?? "unknown"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-fg-2">Running components</span><span className="font-mono tabular-nums">{runningNodes}/{pipeline.nodeStatuses.length || pipeline.nodes.length}</span></div>
              <div className="flex justify-between gap-3"><span className="text-fg-2">Longest uptime</span><span className="font-mono">{formatRelativeSeconds(Math.max(0, ...pipeline.nodeStatuses.map((s) => s.uptimeSeconds ?? 0)))}</span></div>
              <div className="flex justify-between gap-3"><span className="text-fg-2">Last deployed</span><span className="font-mono text-right">{formatDate(pipeline.deployedAt)}</span></div>
            </CardContent>
          </Card>

          <Card className="border-line bg-bg-2">
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em]">
                <ShieldCheck className="h-4 w-4 text-fg-2" />
                Guardrails & recovery
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 py-3 text-[12px]">
              <div className="flex justify-between gap-3"><span className="text-fg-2">Draft parity</span><span className="font-mono">{pipeline.hasConfigChanges ? "pending deploy" : "matches deployed"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-fg-2">Auto rollback</span><span className="font-mono">{pipeline.autoRollbackEnabled ? `${pipeline.autoRollbackThreshold}% / ${pipeline.autoRollbackWindowMinutes}m` : "off"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-fg-2">Metadata enrichment</span><span className="font-mono">{pipeline.enrichMetadata ? "on" : "off"}</span></div>
              <div className="flex justify-between gap-3"><span className="text-fg-2">GitOps mode</span><span className="font-mono">{pipeline.gitOpsMode ?? "disabled"}</span></div>
            </CardContent>
          </Card>
          <Card className="border-line bg-bg-2">
            <CardHeader className="px-4 py-3">
              <CardTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em]">
                <GitCommit className="h-4 w-4 text-fg-2" />
                Version history
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 px-4 py-3 text-[12px]">
              {versions.length ? (
                versions.slice(0, 5).map((version) => (
                  <div key={version.id} className="grid gap-1 border-b border-line pb-2 last:border-b-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3 font-mono">
                      <span className="text-fg">v{version.version}</span>
                      <span className="truncate text-fg-2">
                        {version.createdBy?.name ?? version.createdBy?.email ?? "system"}
                      </span>
                    </div>
                    <div className="font-mono text-[10.5px] text-fg-2">{formatDate(version.createdAt)}</div>
                    <div className="truncate text-fg-1">{version.changelog ?? "No changelog provided."}</div>
                  </div>
                ))
              ) : (
                <div className="text-fg-2">No version history available.</div>
              )}
            </CardContent>
          </Card>
      </div>

      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden border-line bg-bg-2">
          <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
            <CardTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em]">
              <GitCommit className="h-4 w-4 text-fg-2" />
              Edge routing
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {pipeline.edges.length ? (
              <div className="divide-y divide-line">
                {pipeline.edges.map((edge) => {
                  const source = nodeById.get(edge.sourceNodeId);
                  const target = nodeById.get(edge.targetNodeId);
                  return (
                    <div key={edge.id} className="flex items-center gap-3 px-4 py-2.5 text-[12px]">
                      <span className="min-w-0 flex-1 truncate font-mono">{source ? nodeLabel(source) : edge.sourceNodeId}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-fg-2" />
                      <span className="min-w-0 flex-1 truncate font-mono">{target ? nodeLabel(target) : edge.targetNodeId}</span>
                      {edge.sourcePort && <Pill variant="kind" size="xs">{edge.sourcePort}</Pill>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="px-4 py-6 text-[12px] text-fg-2">No edges configured.</div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-line bg-bg-2">
          <CardHeader className="border-b border-line bg-bg-1 px-4 py-3">
            <CardTitle className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.06em]">
              <GitBranch className="h-4 w-4 text-fg-2" />
              Dependencies
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-2">Upstream requirements</h3>
              {upstreamsQuery.data?.length ? (
                <div className="space-y-2">
                  {upstreamsQuery.data.map((dep) => (
                    <Link key={dep.id} href={`/pipelines/${dep.upstream.id}`} className="flex items-center justify-between rounded-[3px] border border-line bg-bg px-3 py-2 text-[12px] hover:bg-bg-1">
                      <span className="truncate font-mono">{dep.upstream.name}</span>
                      <span className="flex shrink-0 items-center gap-2 text-fg-2">
                        {deploymentLabel(dep.upstream)} <ArrowRight className="h-3 w-3" />
                      </span>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-fg-2">No upstream dependencies.</p>
              )}
            </div>
            <div>
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.06em] text-fg-2">Downstream impact</h3>
              <div className="rounded-[3px] border border-line bg-bg p-3 text-[12px]">
                <div className="flex items-center gap-2">
                  <PlayCircle className="h-4 w-4 text-fg-2" />
                  <span className="font-mono">{impactQuery.data?.total ?? 0} dependent pipelines</span>
                </div>
                <p className="mt-2 text-[11px] text-fg-2">
                  {impactQuery.data?.deployed.length ?? 0} deployed, {impactQuery.data?.draft.length ?? 0} draft.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
