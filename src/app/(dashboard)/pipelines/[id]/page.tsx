"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { NodeMetricsData } from "@/stores/flow-store";
import {
  ReactFlowProvider,
  type Node,
  type Edge,
} from "@xyflow/react";
import { Trash2, AlertTriangle } from "lucide-react";
import { formatDistanceToNowStrict } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useTRPC } from "@/trpc/client";
import { useFlowStore } from "@/stores/flow-store";
import { generateVectorYaml } from "@/lib/config-generator";
import { findComponentDef } from "@/lib/vector/catalog";
import { aggregateProcessStatus } from "@/lib/pipeline-status";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { AiPipelineDialog } from "@/components/flow/ai-pipeline-dialog";
import { DetailPanel } from "@/components/flow/detail-panel";
import { DeployDialog } from "@/components/flow/deploy-dialog";
import { SaveTemplateDialog } from "@/components/flow/save-template-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PipelineMetricsChart } from "@/components/pipeline/metrics-chart";
import { PipelineLogs } from "@/components/pipeline/pipeline-logs";
import { useTeamStore } from "@/stores/team-store";
import { QueryError } from "@/components/query-error";
import { useFlowMetrics } from "@/hooks/use-flow-metrics";
import { usePollingInterval } from "@/hooks/use-polling-interval";

/**
 * Convert database PipelineNode rows into React Flow nodes.
 * Each node's data includes the resolved VectorComponentDef from the catalog.
 */
function dbNodesToFlowNodes(
  dbNodes: Array<{
    id: string;
    componentKey: string;
    displayName: string | null;
    componentType: string;
    kind: string;
    config: unknown;
    positionX: number;
    positionY: number;
    disabled?: boolean;
    sharedComponentId?: string | null;
    sharedComponentVersion?: number | null;
    sharedComponent?: {
      name: string;
      version: number;
    } | null;
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
        displayName: n.displayName ?? undefined,
        config: (n.config as Record<string, unknown>) ?? {},
        disabled: n.disabled ?? false,
        sharedComponentId: n.sharedComponentId ?? null,
        sharedComponentVersion: n.sharedComponentVersion ?? null,
        sharedComponentName: n.sharedComponent?.name ?? null,
        sharedComponentLatestVersion: n.sharedComponent?.version ?? null,
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

/**
 * Map common environment names to a CSS variable color so the toolbar Pill
 * shows a tone-appropriate tint. Falls back to undefined for unknown names,
 * which renders the neutral env Pill.
 */
function envPillColor(envName?: string | null): string | undefined {
  if (!envName) return undefined;
  const lower = envName.toLowerCase();
  if (lower === "prod" || lower === "production") return "var(--status-error)";
  if (lower === "staging" || lower === "stage" || lower === "preprod") return "var(--status-degraded)";
  if (lower === "dev" || lower === "development" || lower === "local") return "var(--accent-brand)";
  return undefined;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function statusVariant(status: string): BadgeVariant {
  switch (status) {
    case "DEPLOYED":
      return "default";
    case "PENDING":
    case "APPROVED":
      return "secondary";
    case "REJECTED":
      return "destructive";
    case "CANCELLED":
      return "outline";
    default:
      return "secondary";
  }
}

function PromotionHistory({ pipelineId }: { pipelineId: string }) {
  const trpc = useTRPC();
  const { data: history, isLoading } = useQuery(
    trpc.promotion.history.queryOptions({ pipelineId })
  );

  if (isLoading)
    return (
      <div className="shrink-0 border-t px-4 py-2 text-sm text-muted-foreground">
        Loading promotion history...
      </div>
    );
  if (!history?.length) return null;

  return (
    <div className="shrink-0 border-t">
      <div className="space-y-3 p-4">
        <h3 className="text-sm font-medium">Promotion History</h3>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">Target</th>
                <th className="px-3 py-2 text-left font-medium">Promoted By</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-3 py-2">
                    {new Date(item.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">{item.sourceEnvironment.name}</td>
                  <td className="px-3 py-2">{item.targetEnvironment.name}</td>
                  <td className="px-3 py-2">
                    {item.promotedBy?.name ?? item.promotedBy?.email ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(item.status)}>
                      {item.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PipelineBuilderInner({ pipelineId }: { pipelineId: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [deployOpen, setDeployOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [undeployOpen, setUndeployOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [metricsOpen, setMetricsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(() => searchParams.get("logs") === "1");
  const [aiDialogOpen, setAiDialogOpen] = useState(false);

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const teamQuery = useQuery(
    trpc.team.get.queryOptions(
      { id: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );
  const aiEnabled = teamQuery.data?.aiEnabled ?? false;

  const loadGraph = useFlowStore((s) => s.loadGraph);
  const isDirty = useFlowStore((s) => s.isDirty);
  const markClean = useFlowStore((s) => s.markClean);
  const updateNodeMetrics = useFlowStore((s) => s.updateNodeMetrics);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const globalConfig = useFlowStore((s) => s.globalConfig);

  // Generate current YAML for AI debug panel
  const currentYaml = useMemo(
    () => (nodes.length > 0 ? generateVectorYaml(nodes, edges, globalConfig) : undefined),
    [nodes, edges, globalConfig],
  );

  // Fetch pipeline data
  const pipelineQuery = useQuery(
    trpc.pipeline.get.queryOptions({ id: pipelineId })
  );

  // Fetch undeploy dependency warnings
  const undeployWarningsQuery = useQuery({
    ...trpc.pipelineDependency.undeployWarnings.queryOptions({ pipelineId }),
    enabled: undeployOpen,
  });
  const undeployWarningsData = undeployWarningsQuery.data;

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
    loadGraph(flowNodes, flowEdges, pipelineQuery.data.globalConfig as Record<string, unknown> | null, { isSystem: pipelineQuery.data.isSystem });
  }, [pipelineQuery.data, loadGraph]);

  // Poll per-component metrics from the in-memory MetricStore
  const isDeployed = pipelineQuery.data && !pipelineQuery.data.isDraft;

  // Live SSE metric updates — only when deployed
  useFlowMetrics(isDeployed ? pipelineId : "");

  const pollingInterval = usePollingInterval(5000);
  const componentMetricsQuery = useQuery(
    trpc.metrics.getComponentMetrics.queryOptions(
      { pipelineId, minutes: 5 },
      { enabled: !!isDeployed, refetchInterval: pollingInterval },
    ),
  );

  // Compute session start from minimum uptime across all running nodes.
  // Use dataUpdatedAt (stable timestamp from React Query) instead of Date.now()
  // to satisfy react-hooks/purity (no impure calls) and avoid useEffect+setState.
  const sessionStart = useMemo(() => {
    const statuses = pipelineQuery.data?.nodeStatuses;
    if (!statuses || statuses.length === 0) return null;
    const uptimes = statuses
      .filter((s: { status: string; uptimeSeconds: number | null }) =>
        s.status === "RUNNING" && s.uptimeSeconds != null
      )
      .map((s: { uptimeSeconds: number | null }) => s.uptimeSeconds!);
    if (uptimes.length === 0) return null;
    const minUptime = Math.min(...uptimes);
    return new Date(pipelineQuery.dataUpdatedAt - minUptime * 1000);
  }, [pipelineQuery.data?.nodeStatuses, pipelineQuery.dataUpdatedAt]);

  // Lightweight check for recent errors (for toolbar badge) — scoped to current session
  const recentErrorsQuery = useQuery(
    trpc.pipeline.logs.queryOptions(
      { pipelineId, levels: ["ERROR"], limit: 1, since: sessionStart! },
      { enabled: !!isDeployed && !logsOpen && !!sessionStart, refetchInterval: 10000 },
    ),
  );
  const hasRecentErrors = (recentErrorsQuery.data?.items?.length ?? 0) > 0;

  // Merge component metrics into flow node data
  useEffect(() => {
    const components = componentMetricsQuery.data?.components;
    if (!components) return;

    const metricsMap = new Map<string, NodeMetricsData>();
    for (const [, entry] of Object.entries(components)) {
      const latest = entry.samples[entry.samples.length - 1];
      if (!latest) continue;
      // Events: received rate for sources/sinks, sent rate for transforms (post-filter)
      // Bytes: received for sources (I/O in), sent for sinks (I/O out), neither for transforms
      const eventsPerSec = entry.kind === "TRANSFORM" ? latest.sentEventsRate : latest.receivedEventsRate;
      const bytesPerSec = entry.kind === "SINK" ? latest.sentBytesRate : latest.receivedBytesRate;
      metricsMap.set(entry.componentKey, {
        eventsPerSec,
        bytesPerSec,
        ...(entry.kind === "TRANSFORM" ? { eventsInPerSec: latest.receivedEventsRate } : {}),
        status: eventsPerSec > 0 ? "healthy" : "degraded",
        samples: entry.samples,
        latencyMs: latest.latencyMeanMs,
      });
    }

    if (metricsMap.size > 0) {
      updateNodeMetrics(metricsMap);
    }
  }, [componentMetricsQuery.data, updateNodeMetrics]);

  const queryClient = useQueryClient();

  // Last-saved timestamp for the toolbar's relative-time label.
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Save mutation
  const saveMutation = useMutation(
    trpc.pipeline.saveGraph.mutationOptions({
      onSuccess: () => {
        markClean();
        setLastSavedAt(new Date());
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }) });
        toast.success("Pipeline saved");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save pipeline", { duration: 6000 });
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
          toast.error(result.error || "Undeploy failed", { duration: 6000 });
        }
      },
      onError: (error) => {
        toast.error(error.message || "Failed to undeploy", { duration: 6000 });
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
        toast.error(error.message || "Failed to delete pipeline", { duration: 6000 });
      },
    })
  );

  // Discard changes mutation
  const discardMutation = useMutation(
    trpc.pipeline.discardChanges.mutationOptions({
      onSuccess: () => {
        markClean();
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey() });
        toast.success("Changes discarded — restored to last deployed state");
        setDiscardOpen(false);
      },
      onError: (err) => {
        toast.error("Failed to discard changes", { description: err.message , duration: 6000 });
      },
    })
  );

  // Rename mutation — the toolbar owns the inline-edit UX; this only fires on commit.
  const renameMutation = useMutation(
    trpc.pipeline.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }) });
        toast.success("Pipeline renamed");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to rename pipeline", { duration: 6000 });
      },
    })
  );

  const handleConfirmRename = (trimmed: string) => {
    if (!trimmed || trimmed === pipelineQuery.data?.name) {
      return;
    }
    renameMutation.mutate({ id: pipelineId, name: trimmed });
  };

  // Tick the "last saved" relative label every 15s so it stays roughly accurate
  // without rerendering on every frame.
  const [lastSavedTick, setLastSavedTick] = useState(0);
  useEffect(() => {
    if (!lastSavedAt) return;
    const interval = setInterval(() => setLastSavedTick((n) => n + 1), 15_000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);
  const lastSavedLabel = useMemo(() => {
    if (!lastSavedAt) return undefined;
    // Reference lastSavedTick so this memo recomputes on each tick.
    void lastSavedTick;
    return formatDistanceToNowStrict(lastSavedAt, { addSuffix: true });
  }, [lastSavedAt, lastSavedTick]);

  const buildSavePayload = useCallback(() => {
    const state = useFlowStore.getState();
    return {
      pipelineId,
      nodes: state.nodes.map((n) => ({
        id: n.id,
        componentKey: (n.data as Record<string, unknown>).componentKey as string,
        displayName: (n.data as Record<string, unknown>).displayName as string | undefined,
        componentType: ((n.data as Record<string, unknown>).componentDef as { type: string }).type,
        kind: (n.type?.toUpperCase() ?? "SOURCE") as "SOURCE" | "TRANSFORM" | "SINK",
        config: ((n.data as Record<string, unknown>).config as Record<string, unknown>) ?? {},
        positionX: n.position.x,
        positionY: n.position.y,
        disabled: !!((n.data as Record<string, unknown>).disabled),
        sharedComponentId: ((n.data as Record<string, unknown>).sharedComponentId as string | null) ?? null,
        sharedComponentVersion: ((n.data as Record<string, unknown>).sharedComponentVersion as number | null) ?? null,
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
      <div className="-mx-6 -my-2 flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  if (pipelineQuery.error) {
    return (
      <div className="-mx-6 -my-2 flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <QueryError
          message={`Failed to load pipeline: ${pipelineQuery.error.message}`}
          onRetry={() => pipelineQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="-mx-6 -my-2 flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex items-center border-b">
        <div className="flex-1 min-w-0">
          <FlowToolbar
            pipelineId={pipelineId}
            onSave={handleSave}
            isSaving={saveMutation.isPending}
            onDeploy={handleDeploy}
            onUndeploy={() => setUndeployOpen(true)}
            onSaveAsTemplate={() => setTemplateOpen(true)}
            isDraft={pipelineQuery.data?.isDraft}
            deployedAt={pipelineQuery.data?.deployedAt}
            hasConfigChanges={pipelineQuery.data?.hasConfigChanges}
            isDirty={isDirty}
            metricsOpen={metricsOpen}
            onToggleMetrics={() => setMetricsOpen((v) => !v)}
            logsOpen={logsOpen}
            onToggleLogs={() => setLogsOpen((v) => !v)}
            hasRecentErrors={hasRecentErrors}
            processStatus={
              pipelineQuery.data?.nodeStatuses
                ? aggregateProcessStatus(pipelineQuery.data.nodeStatuses)
                : null
            }
            gitOpsMode={pipelineQuery.data?.gitOpsMode}
            onDiscardChanges={() => setDiscardOpen(true)}
            aiEnabled={aiEnabled}
            onAiOpen={() => setAiDialogOpen(true)}
            deployedVersionNumber={pipelineQuery.data?.deployedVersionNumber}
            pipelineName={pipelineQuery.data?.name ?? "Untitled"}
            environmentName={pipelineQuery.data?.environment?.name}
            environmentColor={envPillColor(pipelineQuery.data?.environment?.name)}
            nodeCount={nodes.length}
            lastSavedLabel={lastSavedLabel}
            onRename={handleConfirmRename}
            isRenaming={renameMutation.isPending}
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
        <DetailPanel
          pipelineId={pipelineId}
          isDeployed={!!isDeployed}
        />
      </div>
      {metricsOpen && (
        <div className="shrink-0 border-t">
          <PipelineMetricsChart pipelineId={pipelineId} />
        </div>
      )}
      {logsOpen && (
        <div className="h-[300px] shrink-0 border-t">
          <PipelineLogs pipelineId={pipelineId} />
        </div>
      )}
      <PromotionHistory pipelineId={pipelineId} />
      <DeployDialog pipelineId={pipelineId} open={deployOpen} onOpenChange={setDeployOpen} />
      <SaveTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} />
      <ConfirmDialog
        open={undeployOpen}
        onOpenChange={setUndeployOpen}
        title="Undeploy pipeline?"
        description={
          undeployWarningsData && undeployWarningsData.length > 0 ? (
            <div className="space-y-3">
              <p>This will stop the running pipeline and remove the deployed configuration. You can redeploy at any time.</p>
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  <p className="font-medium">Deployed downstream pipelines depend on this:</p>
                  <ul className="mt-1 list-disc list-inside">
                    {undeployWarningsData.map(dep => (
                      <li key={dep.downstream.id}>{dep.downstream.name}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : (
            "This will stop the running pipeline and remove the deployed configuration. You can redeploy at any time."
          )
        }
        confirmLabel="Undeploy"
        variant="destructive"
        isPending={undeployMutation.isPending}
        pendingLabel="Undeploying..."
        onConfirm={() => {
          undeployMutation.mutate({ pipelineId });
          setUndeployOpen(false);
        }}
      />
      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>
              This will revert the pipeline to its last deployed state. Any saved changes that haven&apos;t been deployed will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDiscardOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={discardMutation.isPending}
              onClick={() => discardMutation.mutate({ pipelineId })}
            >
              {discardMutation.isPending ? "Discarding..." : "Discard changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {aiEnabled && (
        <AiPipelineDialog
          open={aiDialogOpen}
          onOpenChange={setAiDialogOpen}
          pipelineId={pipelineId}
          environmentName={pipelineQuery.data?.environment?.name}
          currentYaml={currentYaml}
        />
      )}
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
