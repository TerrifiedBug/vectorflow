"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Database, Loader2, Play } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { generateId } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";

type TemplateNode = {
  id: string;
  componentType: string;
  componentKey: string;
  displayName?: string | null;
  kind: "source" | "transform" | "sink";
  config: Record<string, unknown>;
  positionX: number;
  positionY: number;
};

type TemplateEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourcePort?: string;
};

/**
 * v2 per-template detail (D5): description, read-only mini graph, create CTA, usage sidebar.
 */
export default function TemplateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  const templateQuery = useQuery(trpc.template.get.queryOptions({ id: params.id }));
  const template = templateQuery.data;
  const nodes = useMemo(() => (template?.nodes ?? []) as TemplateNode[], [template?.nodes]);
  const edges = useMemo(() => (template?.edges ?? []) as TemplateEdge[], [template?.edges]);

  const createPipelineMutation = useMutation(trpc.pipeline.create.mutationOptions());
  const saveGraphMutation = useMutation(
    trpc.pipeline.saveGraph.mutationOptions({
      onSuccess: (pipeline) => router.push(`/pipelines/${pipeline.id}/edit`),
    }),
  );

  async function handleCreateFromTemplate() {
    if (!template || !selectedEnvironmentId) return;
    const pipeline = await createPipelineMutation.mutateAsync({
      name: `${template.name} Pipeline`,
      description: `Created from template: ${template.description}`,
      environmentId: selectedEnvironmentId,
    });

    const idMap = new Map<string, string>();
    const pipelineNodes = nodes.map((node) => {
      const id = generateId();
      idMap.set(node.id, id);
      return {
        id,
        componentKey: node.componentKey,
        componentType: node.componentType,
        kind: node.kind.toUpperCase() as "SOURCE" | "TRANSFORM" | "SINK",
        config: node.config,
        positionX: node.positionX,
        positionY: node.positionY,
      };
    });
    const pipelineEdges = edges.map((edge) => ({
      id: generateId(),
      sourceNodeId: idMap.get(edge.sourceNodeId) ?? edge.sourceNodeId,
      targetNodeId: idMap.get(edge.targetNodeId) ?? edge.targetNodeId,
      sourcePort: edge.sourcePort,
    }));

    await saveGraphMutation.mutateAsync({
      pipelineId: pipeline.id,
      nodes: pipelineNodes,
      edges: pipelineEdges,
    });
    queryClient.invalidateQueries({ queryKey: trpc.pipeline.list.queryKey() });
  }

  const isCreating = createPipelineMutation.isPending || saveGraphMutation.isPending;

  if (templateQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (templateQuery.isError) {
    return <QueryError message="Failed to load template" onRetry={() => templateQuery.refetch()} />;
  }

  if (!template) {
    return <EmptyState title="Template not found" />;
  }

  return (
    <div className="space-y-5 bg-bg text-fg">
      <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-fg-2">
            library / templates / {template.category}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-[22px] font-medium tracking-[-0.01em] text-fg">{template.name}</h1>
            <Badge variant="outline" className="rounded-[3px] font-mono text-[10px] uppercase tracking-[0.04em]">v1</Badge>
            <Badge variant="outline" className="rounded-[3px] font-mono text-[10px] uppercase tracking-[0.04em] text-accent-brand">{template.category}</Badge>
            <span className="font-mono text-[11px] text-fg-2">Used by 0 pipelines</span>
          </div>
          <p className="mt-2 max-w-[760px] text-[12px] leading-relaxed text-fg-1">{template.description}</p>
        </div>
        <Button variant="primary" size="sm" disabled={!selectedEnvironmentId || isCreating} onClick={handleCreateFromTemplate}>
          {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Create from template
        </Button>
      </div>

      {!selectedEnvironmentId && (
        <EmptyState title="Select an environment" description="Choose an environment from the header before creating a pipeline from this template." />
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="border-line bg-bg-2">
          <CardHeader className="border-b border-line bg-bg-1 py-3">
            <CardTitle className="font-mono text-[14px] font-medium">Template graph</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            <MiniTemplateGraph nodes={nodes} edges={edges} />
          </CardContent>
        </Card>

        <aside className="space-y-4">
          <Card className="border-line bg-bg-2">
            <CardHeader className="border-b border-line bg-bg-1 py-3">
              <CardTitle className="font-mono text-[14px] font-medium">Inventory</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-4 font-mono text-[11.5px]">
              <div className="flex justify-between"><span className="text-fg-2">nodes</span><span>{nodes.length}</span></div>
              <div className="flex justify-between"><span className="text-fg-2">edges</span><span>{edges.length}</span></div>
              <div className="flex justify-between"><span className="text-fg-2">category</span><span>{template.category}</span></div>
            </CardContent>
          </Card>
          <Card className="border-line bg-bg-2">
            <CardHeader className="border-b border-line bg-bg-1 py-3">
              <CardTitle className="font-mono text-[14px] font-medium">Used by</CardTitle>
            </CardHeader>
            <CardContent className="p-4 font-mono text-[11.5px] text-fg-2">
              No pipelines are linked to this template yet.
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function MiniTemplateGraph({ nodes, edges }: { nodes: TemplateNode[]; edges: TemplateEdge[] }) {
  if (nodes.length === 0) return <div className="font-mono text-[11.5px] text-fg-2">No nodes in template.</div>;
  return (
    <div className="min-h-[240px] rounded-[3px] border border-line bg-[radial-gradient(var(--line-2)_1px,transparent_1px)] [background-size:20px_20px] p-5">
      <div className="flex flex-wrap items-center gap-2">
        {nodes.map((node, index) => (
          <div key={node.id} className="flex items-center gap-2">
            <div className="rounded-[3px] border border-line-2 bg-bg-2 px-3 py-2">
              <div className={`mb-1 h-[3px] rounded-full ${kindBar(node.kind)}`} />
              <div className="font-mono text-[11.5px] text-fg">{node.displayName || node.componentKey}</div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.06em] text-fg-2">{node.kind} · {node.componentType}</div>
            </div>
            {index < nodes.length - 1 && <ChevronRight className="h-4 w-4 text-fg-3" />}
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-4 font-mono text-[10.5px] text-fg-2">
        <span className="inline-flex items-center gap-1"><Database className="h-3 w-3" />{nodes.length} nodes</span>
        <span className="inline-flex items-center gap-1"><ArrowRight className="h-3 w-3" />{edges.length} edges</span>
      </div>
    </div>
  );
}

function kindBar(kind: TemplateNode["kind"]) {
  if (kind === "source") return "bg-source";
  if (kind === "transform") return "bg-transform";
  return "bg-sink";
}
