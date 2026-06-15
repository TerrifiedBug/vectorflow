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
import { useTRPC } from "@/trpc/client";
import { useFlowStore } from "@/stores/flow-store";
import { generateVectorYaml } from "@/lib/config-generator";
import { findComponentDef } from "@/lib/vector/catalog";
import { validateNodeConfig } from "@/lib/vector/validate-node-config";
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
import { LiveTailPanel } from "@/components/flow/live-tail-panel";
import { DeployDialog } from "@/components/flow/deploy-dialog";
import { SaveTemplateDialog } from "@/components/flow/save-template-dialog";
import { CompliancePresetsDialog } from "@/components/flow/compliance-presets-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PipelineMetricsChart } from "@/components/pipeline/metrics-chart";
import { PipelineLogs } from "@/components/pipeline/pipeline-logs";
import { useTeamStore } from "@/stores/team-store";
import { QueryError } from "@/components/query-error";
import { useFlowMetrics } from "@/hooks/use-flow-metrics";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import { sourceBytesRate, sourceEventsRate } from "@/lib/metrics/component-rates";

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
    groupId?: string | null;
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
        groupId: n.groupId ?? undefined,
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
    type: "metric",
  }));
}




function PipelineBuilderInner({ pipelineId }: { pipelineId: string }) {
  const trpc = useTRPC();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [deployOpen, setDeployOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [compliancePresetOpen, setCompliancePresetOpen] = useState(false);
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
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const globalConfig = useFlowStore((s) => s.globalConfig);

  // Generate current YAML for AI debug panel
  const currentYaml = useMemo(
    () => (nodes.length > 0 ? generateVectorYaml(nodes, edges, globalConfig) : undefined),
    [nodes, edges, globalConfig],
  );

  const selectedComponentKey = useMemo(() => {
    if (!selectedNodeId) return null;
    const node = nodes.find((n) => n.id === selectedNodeId);
    return (node?.data as { componentKey?: string } | undefined)?.componentKey ?? null;
  }, [nodes, selectedNodeId]);

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
    // Hydrate the store once per mount. Refetches (e.g. the cache invalidation
    // after auto-save) must NOT re-run loadGraph: it resets selectedNodeId and
    // would kick the user out of the detail/edit panel mid-edit. The store is
    // the source of truth while mounted; a remount re-hydrates from fresh data.
    if (hasLoadedRef.current) return;
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
      // Events/bytes: sources usually report received rates, but some pull-based
      // sources (docker_logs) only expose sent rates as their emitted event count.
      const eventsPerSec =
        entry.kind === "TRANSFORM"
          ? latest.sentEventsRate
          : entry.kind === "SOURCE"
            ? sourceEventsRate(latest)
            : latest.receivedEventsRate;
      const bytesPerSec =
        entry.kind === "SINK"
          ? latest.sentBytesRate
          : entry.kind === "SOURCE"
            ? sourceBytesRate(latest)
            : latest.receivedBytesRate;
      metricsMap.set(entry.componentKey, {
        eventsPerSec,
        bytesPerSec,
        ...(entry.kind === "TRANSFORM" ? { eventsInPerSec: latest.receivedEventsRate } : {}),
        status: eventsPerSec > 0 ? "healthy" : "degraded",
        samples: entry.samples,
        latencyMs: latest.latencyMeanMs,
      });
    }

    updateNodeMetrics(metricsMap);
  }, [componentMetricsQuery.data, updateNodeMetrics]);

  const queryClient = useQueryClient();

  // Last-saved timestamp for the toolbar's relative-time label.
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Save mutation
  const saveMutation = useMutation(
    trpc.pipeline.saveGraph.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }) });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to save pipeline", { duration: 6000 });
      },
    })
  );

  // Undeploy mutation
  const undeployMutation = useMutation(
    trpc.release.direct.undeploy.mutationOptions({
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
        groupId: ((n.data as Record<string, unknown>).groupId as string | null) ?? null,
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

  const validationErrors = useMemo(() => {
    return nodes.flatMap((node) => {
      const data = node.data as {
        componentDef?: { displayName?: string; configSchema?: object };
        displayName?: string;
        config?: Record<string, unknown>;
      };
      const schema = data.componentDef?.configSchema;
      if (!schema) return [];
      const result = validateNodeConfig(data.config ?? {}, schema);
      if (!result.hasError) return [];
      const label = data.displayName ?? data.componentDef?.displayName ?? "Component";
      return [`${label}: ${result.firstErrorMessage ?? "Invalid configuration"}`];
    });
  }, [nodes]);

  const firstValidationError = validationErrors[0];

  const markSavedIfCurrent = useCallback(
    (payload: ReturnType<typeof buildSavePayload>) => {
      if (JSON.stringify(payload) !== JSON.stringify(buildSavePayload())) {
        return false;
      }
      markClean();
      setLastSavedAt(new Date());
      return true;
    },
    [buildSavePayload, markClean],
  );

  const handleSave = useCallback(() => {
    const payload = buildSavePayload();
    saveMutation.mutate(payload, {
      onSuccess: () => {
        if (markSavedIfCurrent(payload)) {
          toast.success("Pipeline saved");
        }
      },
    });
  }, [saveMutation, buildSavePayload, markSavedIfCurrent]);

  useEffect(() => {
    if (!isDirty || saveMutation.isPending) return;
    const timeout = window.setTimeout(() => {
      const payload = buildSavePayload();
      saveMutation.mutate(payload, {
        onSuccess: () => {
          markSavedIfCurrent(payload);
        },
      });
    }, 2_000);
    return () => window.clearTimeout(timeout);
  }, [isDirty, saveMutation, buildSavePayload, markSavedIfCurrent, nodes, edges, globalConfig]);

  // Auto-save before deploying so the deploy dialog previews the current editor
  // state, not stale DB state. This prevents "no changes" deploys when users
  // edit without explicitly saving first.
  const handleDeploy = useCallback(async () => {
    if (validationErrors.length > 0) {
      toast.error("Fix validation errors before deploying", {
        description: firstValidationError,
        duration: 6000,
      });
      return;
    }
    try {
      const payload = buildSavePayload();
      await saveMutation.mutateAsync(payload);
      if (!markSavedIfCurrent(payload)) {
        toast.error("Newer edits are still unsaved", {
          description: "Wait for autosave to finish, then deploy again.",
          duration: 6000,
        });
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }),
      });
      setDeployOpen(true);
    } catch {
      // Save error already toasted by saveMutation's onError handler
    }
  }, [validationErrors.length, firstValidationError, saveMutation, buildSavePayload, markSavedIfCurrent, queryClient, trpc.pipeline.get, pipelineId]);

  if (pipelineQuery.isLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] min-w-0 max-w-full items-center justify-center overflow-hidden">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  if (pipelineQuery.error) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] min-w-0 max-w-full items-center justify-center overflow-hidden">
        <QueryError
          message={`Failed to load pipeline: ${pipelineQuery.error.message}`}
          onRetry={() => pipelineQuery.refetch()}
        />
      </div>
    );
  }

  const showDraftBanner = isDirty || !!pipelineQuery.data?.hasConfigChanges;
  const draftBannerTitle = isDirty ? "Unsaved draft" : "Saved draft pending deploy";
  const deployedLabel = pipelineQuery.data?.deployedVersionNumber
    ? `deployed v${pipelineQuery.data.deployedVersionNumber}`
    : pipelineQuery.data?.deployedAt
      ? "deployed"
      : "not deployed";
  const draftSaveLabel = isDirty
    ? (lastSavedLabel ? `last saved ${lastSavedLabel}` : "autosave pending")
    : "last saved draft differs from deployed";

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-w-0 max-w-full flex-col overflow-hidden">
      <div className="flex min-w-0 items-center border-b">
        <div className="flex-1 min-w-0">
          <FlowToolbar
            pipelineId={pipelineId}
            onSave={handleSave}
            isSaving={saveMutation.isPending}
            onDeploy={handleDeploy}
            onUndeploy={() => setUndeployOpen(true)}
            onSaveAsTemplate={() => setTemplateOpen(true)}
            onApplyCompliancePreset={() => setCompliancePresetOpen(true)}
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
            nodeCount={nodes.length}
            lastSavedLabel={lastSavedLabel}
            onRename={handleConfirmRename}
            isRenaming={renameMutation.isPending}
            validationErrorCount={validationErrors.length}
            validationMessage={firstValidationError}
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
      {showDraftBanner && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-status-degraded/30 bg-status-degraded-bg px-4 py-2 text-[12px]">
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-status-degraded" />
            <span className="font-mono uppercase tracking-[0.05em] text-status-degraded">{draftBannerTitle}</span>
            <span className="truncate text-fg-1">
              Draft graph differs from {deployedLabel}; deploy when ready to promote the current draft.
            </span>
          </div>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-fg-2">{draftSaveLabel}</span>
        </div>
      )}
      {validationErrors.length > 0 && (
        <div className="flex items-center gap-2 border-b border-status-error/30 bg-status-error/5 px-4 py-1.5 text-[12px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-error" />
          <span className="font-mono uppercase tracking-[0.05em] text-status-error">
            {validationErrors.length} validation {validationErrors.length === 1 ? "error" : "errors"}
          </span>
          <span className="truncate text-fg-1">{firstValidationError}</span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 overflow-hidden">
        <ComponentPalette />
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <FlowCanvas />
          <LiveTailPanel
            pipelineId={pipelineId}
            componentKey={selectedComponentKey}
            isDeployed={!!isDeployed}
          />
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
      <DeployDialog pipelineId={pipelineId} open={deployOpen} onOpenChange={setDeployOpen} />
      <SaveTemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} />
      <CompliancePresetsDialog open={compliancePresetOpen} onOpenChange={setCompliancePresetOpen} />
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


export default function PipelineBuilderPageClient() {
  const params = useParams<{ id: string }>();

  return (
    <ReactFlowProvider>
      <PipelineBuilderInner pipelineId={params.id} />
    </ReactFlowProvider>
  );
}
