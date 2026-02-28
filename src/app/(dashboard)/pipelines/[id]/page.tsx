"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  const router = useRouter();
  const [deployOpen, setDeployOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

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

  const queryClient = useQueryClient();

  // Undeploy mutation
  const undeployMutation = useMutation(
    trpc.deploy.undeploy.mutationOptions({
      onSuccess: (result) => {
        if (result.success) {
          toast.success("Pipeline undeployed from git");
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
        // If deployed, trigger redeploy so git reflects the new name
        if (!pipelineQuery.data?.isDraft && pipelineQuery.data?.deployedAt) {
          setDeployOpen(true);
          toast.info("Pipeline is deployed — redeploy to update the name in git");
        }
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
      <div className="flex items-center">
        <div className="flex-1">
          <FlowToolbar
            pipelineId={pipelineId}
            onSave={handleSave}
            isSaving={saveMutation.isPending}
            onDeploy={() => setDeployOpen(true)}
            onUndeploy={() => undeployMutation.mutate({ pipelineId })}
            onSaveAsTemplate={() => setTemplateOpen(true)}
            isDraft={pipelineQuery.data?.isDraft}
            deployedAt={pipelineQuery.data?.deployedAt}
            updatedAt={pipelineQuery.data?.updatedAt}
          />
        </div>
        <div className="flex items-center gap-2 border-b px-3 h-10">
          {/* Inline pipeline name — click to rename */}
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
