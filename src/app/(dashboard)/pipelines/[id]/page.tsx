"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, GitBranch, Pencil, PlayCircle } from "lucide-react";
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

export default function PipelineDetailPage() {
  const params = useParams<{ id: string }>();
  const pipelineId = params.id;
  const trpc = useTRPC();

  const pipelineQuery = useQuery(trpc.pipeline.get.queryOptions({ id: pipelineId }));
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

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{pipeline.name}</h1>
            <Pill variant={status === "Deployed" ? "ok" : "status"} size="sm">
              {status}
            </Pill>
            {pipeline.hasConfigChanges && (
              <Pill variant="warn" size="sm">changes pending</Pill>
            )}
          </div>
          <p className="max-w-2xl text-sm text-fg-2">
            {pipeline.description || "No description provided."}
          </p>
        </div>
        <Button asChild variant="primary" size="sm" className="gap-1.5">
          <Link href={`/pipelines/${pipelineId}/edit`}>
            <Pencil className="h-3.5 w-3.5" />
            Edit pipeline
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle>Components</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{pipeline.nodes.length}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Edges</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{pipeline.edges.length}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Process</CardTitle></CardHeader>
          <CardContent className="text-sm font-medium capitalize">{processStatus?.toLowerCase() ?? "unknown"}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Last deployed</CardTitle></CardHeader>
          <CardContent className="text-sm text-fg-1">{formatDate(pipeline.deployedAt)}</CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader><CardTitle>Topology</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[3px] border border-line bg-bg-1 p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">Sources</div>
              <div className="mt-1 text-xl font-semibold">{sources}</div>
            </div>
            <div className="rounded-[3px] border border-line bg-bg-1 p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">Transforms</div>
              <div className="mt-1 text-xl font-semibold">{transforms}</div>
            </div>
            <div className="rounded-[3px] border border-line bg-bg-1 p-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">Sinks</div>
              <div className="mt-1 text-xl font-semibold">{sinks}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Environment</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><span className="text-fg-2">Name</span><span>{pipeline.environment.name}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-2">GitOps</span><span>{pipeline.gitOpsMode ?? "disabled"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-fg-2">Version</span><span>{pipeline.deployedVersionNumber ?? "—"}</span></div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><GitBranch className="h-4 w-4" /> Dependencies</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-2">Upstream requirements</h3>
            {upstreamsQuery.data?.length ? (
              <div className="space-y-2">
                {upstreamsQuery.data.map((dep) => (
                  <Link key={dep.id} href={`/pipelines/${dep.upstream.id}`} className="flex items-center justify-between rounded-[3px] border border-line px-3 py-2 text-sm hover:bg-bg-1">
                    <span>{dep.upstream.name}</span>
                    <span className="flex items-center gap-2 text-fg-2">
                      {deploymentLabel(dep.upstream)} <ArrowRight className="h-3 w-3" />
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-fg-2">No upstream dependencies.</p>
            )}
          </div>
          <div>
            <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-2">Downstream impact</h3>
            <div className="rounded-[3px] border border-line p-3 text-sm">
              <div className="flex items-center gap-2">
                <PlayCircle className="h-4 w-4 text-fg-2" />
                <span>{impactQuery.data?.total ?? 0} dependent pipelines</span>
              </div>
              <p className="mt-2 text-xs text-fg-2">
                {impactQuery.data?.deployed.length ?? 0} deployed, {impactQuery.data?.draft.length ?? 0} draft.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
