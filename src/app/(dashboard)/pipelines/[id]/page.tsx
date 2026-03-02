"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { NodeMetricsData } from "@/stores/flow-store";
import {
  ReactFlowProvider,
  type Node,
  type Edge,
} from "@xyflow/react";
import { Trash2, Pencil, Check, X } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { useFlowStore } from "@/stores/flow-store";
import { findComponentDef } from "@/lib/vector/catalog";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ComponentPalette } from "@/components/flow/component-palette";
import { FlowCanvas } from "@/components/flow/flow-canvas";
import { FlowToolbar } from "@/components/flow/flow-toolbar";
import { DetailPanel } from "@/components/flow/detail-panel";
import { DeployDialog } from "@/components/flow/deploy-dialog";
import { SaveTemplateDialog } from "@/components/flow/save-template-dialog";
import { PipelineMetricsChart } from "@/components/pipeline/metrics-chart";

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
    disabled?: boolean;
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
        disabled: n.disabled ?? false,
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
  const router = useRouter();
  const [deployOpen, setDeployOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);

  const loadGraph = useFlowStore((s) => s.loadGraph);
  const isDirty = useFlowStore((s) => s.isDirty);
  const markClean = useFlowStore((s) => s.markClean);
  const updateNodeMetrics = useFlowStore((s) => s.updateNodeMetrics);

  // Fetch pipeline data
  const pipelineQuery = useQuery(
    trpc.pipeline.get.queryOptions({ id: pipelineId })
  );

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useFlowStore.getState().isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Load graph into the store when data arrives — but skip if the user has
  // unsaved edits so that navigating away and back doesn't wipe them.
  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (!pipelineQuery.data) return;
    if (hasLoadedRef.current && useFlowStore.getState().isDirty) return;
    hasLoadedRef.current = true;
    const flowNodes = dbNodesToFlowNodes(pipelineQuery.data.nodes);
    const flowEdges = dbEdgesToFlowEdges(pipelineQuery.data.edges);
    loadGraph(flowNodes, flowEdges, pipelineQuery.data.globalConfig as Record<string, unknown> | null);
  }, [pipelineQuery.data, loadGraph]);

  // Poll per-component metrics from the in-memory MetricStore
  const isDeployed = pipelineQuery.data && !pipelineQuery.data.isDraft;
  const componentMetricsQuery = useQuery(
    trpc.metrics.getComponentMetrics.queryOptions(
      { pipelineId, minutes: 5 },
      { enabled: !!isDeployed, refetchInterval: 5000 },
    ),
  );

  // Merge component metrics into flow node data
  useEffect(() => {
    const components = componentMetricsQuery.data?.components;
    if (!components) return;

    const metricsMap = new Map<string, NodeMetricsData>();
    for (const [, entry] of Object.entries(components)) {
      const latest = entry.samples[entry.samples.length - 1];
      if (!latest) continue;
      metricsMap.set(entry.componentKey, {
        eventsPerSec: latest.sentEventsRate,
        bytesPerSec: latest.sentBytesRate,
        status: latest.sentEventsRate > 0 ? "healthy" : "degraded",
        samples: entry.samples,
      });
    }

    if (metricsMap.size > 0) {
      updateNodeMetrics(metricsMap);
    }
  }, [componentMetricsQuery.data, updateNodeMetrics]);

  const queryClient = useQueryClient();

  // Save mutation
  const saveMutation = useMutation(
    trpc.pipeline.saveGraph.mutationOptions({
      onSuccess: () => {
        markClean();
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }) });
        toast.success("Pipeline saved");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save pipeline");
      },
    })
  );

  // Undeploy mutation
  const undeployMutation = useMutation(
    trpc.deploy.undeploy.mutationOptions({
      onSuccess: (result) => {
        if (result.success) {
          toast.success("Pipeline undeployed");
          queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }) });
        } else {
          toast.error(result.error || "Undeploy failed");
        }
      },
      onError: (error) => {
        toast.error(error.message || "Failed to undeploy");
      },
    })
  );

  // Delete mutation
  const deleteMutation = useMutation(
    trpc.pipeline.delete.mutationOptions({
      onSuccess: () => {
        toast.success("Pipeline deleted");
        router.push("/pipelines");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to delete pipeline");
      },
    })
  );

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const renameMutation = useMutation(
    trpc.pipeline.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }) });
        setIsRenaming(false);
        toast.success("Pipeline renamed");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to rename pipeline");
      },
    })
  );

  const handleStartRename = () => {
    setRenameValue(pipelineQuery.data?.name ?? "");
    setIsRenaming(true);
  };

  const handleConfirmRename = () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === pipelineQuery.data?.name) {
      setIsRenaming(false);
      return;
    }
    renameMutation.mutate({ id: pipelineId, name: trimmed });
  };

  const buildSavePayload = useCallback(() => {
    const state = useFlowStore.getState();
    return {
      pipelineId,
      nodes: state.nodes.map((n) => ({
        id: n.id,
        componentKey: (n.data as Record<string, unknown>).componentKey as string,
        componentType: ((n.data as Record<string, unknown>).componentDef as { type: string }).type,
        kind: (n.type?.toUpperCase() ?? "SOURCE") as "SOURCE" | "TRANSFORM" | "SINK",
        config: ((n.data as Record<string, unknown>).config as Record<string, unknown>) ?? {},
        positionX: n.position.x,
        positionY: n.position.y,
        disabled: !!((n.data as Record<string, unknown>).disabled),
      })),
      edges: state.edges.map((e) => ({
        id: e.id,
        sourceNodeId: e.source,
        targetNodeId: e.target,
        sourcePort: e.sourceHandle ?? undefined,
      })),
      globalConfig: state.globalConfig,
    };
  }, [pipelineId]);

  const handleSave = useCallback(() => {
    saveMutation.mutate(buildSavePayload());
  }, [saveMutation, buildSavePayload]);

  // Auto-save before deploying so the deploy dialog previews the current editor
  // state, not stale DB state. This prevents "no changes" deploys when users
  // edit without explicitly saving first.
  const handleDeploy = useCallback(async () => {
    try {
      await saveMutation.mutateAsync(buildSavePayload());
      await queryClient.invalidateQueries({
        queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }),
      });
      setDeployOpen(true);
    } catch {
      // Save error already toasted by saveMutation's onError handler
    }
  }, [saveMutation, buildSavePayload, queryClient, trpc.pipeline.get, pipelineId]);

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
      <div className="flex h-10 items-center border-b">
        {/* Pipeline name — click to rename */}
        <div className="flex items-center gap-1 border-r px-3">
          {isRenaming ? (
            <div className="flex items-center gap-1">
              <Input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirmRename();
                  if (e.key === "Escape") setIsRenaming(false);
                }}
                className="h-7 w-48 text-xs"
                autoFocus
                disabled={renameMutation.isPending}
              />
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleConfirmRename} disabled={renameMutation.isPending}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setIsRenaming(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <button
              onClick={handleStartRename}
              className="group flex items-center gap-1.5 rounded px-2 py-1 text-sm font-medium hover:bg-accent transition-colors"
              title="Click to rename"
            >
              {pipelineQuery.data?.name ?? "Untitled"}
              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>
        <div className="flex-1">
          <FlowToolbar
            pipelineId={pipelineId}
            onSave={handleSave}
            isSaving={saveMutation.isPending}
            onDeploy={handleDeploy}
            onUndeploy={() => undeployMutation.mutate({ pipelineId })}
            onSaveAsTemplate={() => setTemplateOpen(true)}
            isDraft={pipelineQuery.data?.isDraft}
            deployedAt={pipelineQuery.data?.deployedAt}
            hasConfigChanges={pipelineQuery.data?.hasConfigChanges}
            isDirty={isDirty}
            metricsOpen={metricsOpen}
            onToggleMetrics={() => setMetricsOpen((v) => !v)}
          />
        </div>
        <div className="flex items-center px-3">
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm" className="h-7 gap-1.5 px-2.5 text-xs">
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete pipeline?</DialogTitle>
                <DialogDescription>
                  This will permanently delete this pipeline and all its versions, nodes, and edges. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => deleteMutation.mutate({ id: pipelineId })}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <ComponentPalette />
        <div className="flex-1">
          <FlowCanvas />
        </div>
        <DetailPanel />
      </div>
      {metricsOpen && (
        <div className="shrink-0 border-t">
          <PipelineMetricsChart pipelineId={pipelineId} />
        </div>
      )}
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
