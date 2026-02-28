"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  ReactFlowProvider,
  type Node,
  type Edge,
} from "@xyflow/react";
import { useTRPC } from "@/trpc/client";
import { useFlowStore } from "@/stores/flow-store";
import { findComponentDef } from "@/lib/vector/catalog";
import { toast } from "sonner";

import { ComponentPalette } from "@/components/flow/component-palette";
import { FlowCanvas } from "@/components/flow/flow-canvas";
import { FlowToolbar } from "@/components/flow/flow-toolbar";
import { DetailPanel } from "@/components/flow/detail-panel";
import { DeployDialog } from "@/components/flow/deploy-dialog";
import { SaveTemplateDialog } from "@/components/flow/save-template-dialog";

/**
 * Convert database PipelineNode rows into React Flow nodes.
 * Each node's data includes the resolved VectorComponentDef from the catalog.
 */
function dbNodesToFlowNodes(
  dbNodes: Array<{
    id: string;
    componentKey: string;
    componentType: string;
    kind: string;
    config: unknown;
    positionX: number;
    positionY: number;
  }>
): Node[] {
  return dbNodes.map((n) => {
    const kind = n.kind.toLowerCase() as "source" | "transform" | "sink";
    const componentDef = findComponentDef(n.componentType, kind);
    return {
      id: n.id,
      type: kind,
      position: { x: n.positionX, y: n.positionY },
      data: {
        componentDef: componentDef ?? {
          type: n.componentType,
          kind,
          displayName: n.componentType,
          description: "",
          category: "Unknown",
          outputTypes: [],
          configSchema: {},
        },
        componentKey: n.componentKey,
        config: (n.config as Record<string, unknown>) ?? {},
      },
    };
  });
}

/**
 * Convert database PipelineEdge rows into React Flow edges.
 */
function dbEdgesToFlowEdges(
  dbEdges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    sourcePort: string | null;
  }>
): Edge[] {
  return dbEdges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    ...(e.sourcePort ? { sourceHandle: e.sourcePort } : {}),
  }));
}

function PipelineBuilderInner({ pipelineId }: { pipelineId: string }) {
  const trpc = useTRPC();
  const [deployOpen, setDeployOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const loadGraph = useFlowStore((s) => s.loadGraph);

  // Fetch pipeline data
  const pipelineQuery = useQuery(
    trpc.pipeline.get.queryOptions({ id: pipelineId })
  );

  // Load graph into the store when data arrives
  useEffect(() => {
    if (pipelineQuery.data) {
      const flowNodes = dbNodesToFlowNodes(pipelineQuery.data.nodes);
      const flowEdges = dbEdgesToFlowEdges(pipelineQuery.data.edges);
      loadGraph(flowNodes, flowEdges);
    }
  }, [pipelineQuery.data, loadGraph]);

  // Save mutation
  const saveMutation = useMutation(
    trpc.pipeline.saveGraph.mutationOptions({
      onSuccess: () => {
        toast.success("Pipeline saved");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save pipeline");
      },
    })
  );

  const handleSave = useCallback(() => {
    const currentNodes = useFlowStore.getState().nodes;
    const currentEdges = useFlowStore.getState().edges;

    saveMutation.mutate({
      pipelineId,
      nodes: currentNodes.map((n) => ({
        id: n.id,
        componentKey: (n.data as Record<string, unknown>).componentKey as string,
        componentType: ((n.data as Record<string, unknown>).componentDef as { type: string }).type,
        kind: (n.type?.toUpperCase() ?? "SOURCE") as "SOURCE" | "TRANSFORM" | "SINK",
        config: ((n.data as Record<string, unknown>).config as Record<string, unknown>) ?? {},
        positionX: n.position.x,
        positionY: n.position.y,
      })),
      edges: currentEdges.map((e) => ({
        id: e.id,
        sourceNodeId: e.source,
        targetNodeId: e.target,
        sourcePort: e.sourceHandle ?? undefined,
      })),
    });
  }, [pipelineId, saveMutation]);

  if (pipelineQuery.isLoading) {
    return (
      <div className="-m-6 flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-muted-foreground">Loading pipeline...</p>
      </div>
    );
  }

  if (pipelineQuery.error) {
    return (
      <div className="-m-6 flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <p className="text-destructive">
          Failed to load pipeline: {pipelineQuery.error.message}
        </p>
      </div>
    );
  }

  return (
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col">
      <FlowToolbar pipelineId={pipelineId} onSave={handleSave} isSaving={saveMutation.isPending} onDeploy={() => setDeployOpen(true)} onSaveAsTemplate={() => setTemplateOpen(true)} />
      <div className="flex flex-1 overflow-hidden">
        <ComponentPalette />
        <div className="flex-1">
          <FlowCanvas />
        </div>
        <DetailPanel />
      </div>
      <DeployDialog pipelineId={pipelineId} open={deployOpen} onOpenChange={setDeployOpen} />
      <SaveTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} />
    </div>
  );
}

export default function PipelineBuilderPage() {
  const params = useParams<{ id: string }>();

  return (
    <ReactFlowProvider>
      <PipelineBuilderInner pipelineId={params.id} />
    </ReactFlowProvider>
  );
}
