"use client";

import { createElement, useCallback, useMemo, useState } from "react";
import {
  Copy,
  Trash2,
  Lock,
  Info,
  MousePointerClick,
  Book,
  Link2 as LinkIcon,
  Unlink,
  AlertTriangle,
  ExternalLink,
  ChevronsLeft,
  ChevronsRight,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { useFlowStore } from "@/stores/flow-store";
import { SchemaForm } from "@/components/config-forms/schema-form";
import { VrlEditor } from "@/components/vrl-editor/vrl-editor";
import { InspectorSchemaTab } from "@/components/flow/inspector-schema-tab";
import { InspectorMetricsTab } from "@/components/flow/inspector-metrics-tab";
import { InspectorLogsTab } from "@/components/flow/inspector-logs-tab";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status-dot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getVectorCatalog } from "@/lib/vector/catalog";
import { getIcon } from "@/components/flow/node-icon";
import type { VectorComponentDef } from "@/lib/vector/types";
import type { Node, Edge } from "@xyflow/react";
import { formatEventsRate } from "@/lib/format";
import { normalizeTailSampleConfig } from "@/lib/vector/tail-sample";
import { LAKE_SINK_TYPE } from "@/lib/vector/lake-sink";

/* ------------------------------------------------------------------ */
/*  Node-type color tokens                                             */
/* ------------------------------------------------------------------ */

const NODE_COLOR_VAR: Record<string, string> = {
  source: "var(--node-source)",
  transform: "var(--node-transform)",
  sink: "var(--node-sink)",
};

/* ------------------------------------------------------------------ */
/*  Helper: filter out VRL-managed fields from the schema              */
/* ------------------------------------------------------------------ */

const VRL_FIELDS: Record<string, string[]> = {
  remap: ["source"],
  filter: ["condition"],
  route: ["route"],
};

function filterSchema(
  schema: {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
  },
  componentType: string,
): typeof schema {
  const fieldsToExclude = VRL_FIELDS[componentType];
  if (!fieldsToExclude || !schema.properties) return schema;

  const filtered = { ...schema.properties };
  for (const field of fieldsToExclude) {
    delete filtered[field];
  }

  return {
    ...schema,
    properties: filtered,
    required: schema.required?.filter((r) => !fieldsToExclude.includes(r)),
  };
}

/* ------------------------------------------------------------------ */
/*  Helper: trace upstream to find source types                        */
/* ------------------------------------------------------------------ */

function getUpstreamSources(
  nodeId: string,
  allNodes: Node[],
  allEdges: Edge[],
): { sourceTypes: string[]; sourceKeys: string[] } {
  const sourceTypes = new Set<string>();
  const sourceKeys = new Set<string>();
  const visited = new Set<string>();
  const queue = [nodeId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const incomingEdges = allEdges.filter((e) => e.target === currentId);
    for (const edge of incomingEdges) {
      const upstreamNode = allNodes.find((n) => n.id === edge.source);
      if (!upstreamNode) continue;

      const data = upstreamNode.data as {
        componentDef?: VectorComponentDef;
        componentKey?: string;
      };
      if (data.componentDef?.kind === "source") {
        sourceTypes.add(data.componentDef.type);
        if (data.componentKey) sourceKeys.add(data.componentKey);
      } else {
        queue.push(upstreamNode.id);
      }
    }
  }

  return { sourceTypes: [...sourceTypes], sourceKeys: [...sourceKeys] };
}

/* ------------------------------------------------------------------ */
/*  Inspector header                                                   */
/* ------------------------------------------------------------------ */

interface InspectorHeaderProps {
  componentDef: VectorComponentDef;
  displayName: string;
  evPerSec?: string;
  statusVariant: "ok" | "warn" | "status";
  statusDotVariant: "healthy" | "degraded" | "error" | "idle";
  statusLabel: string;
  onClose: () => void;
}

function InspectorHeader({
  componentDef,
  displayName,
  evPerSec,
  statusVariant,
  statusDotVariant,
  statusLabel,
  onClose,
}: InspectorHeaderProps) {
  const color = NODE_COLOR_VAR[componentDef.kind] ?? "var(--fg-1)";
  const iconElement = createElement(getIcon(componentDef.icon), {
    className: "h-[13px] w-[13px]",
  });

  return (
    <div className="border-b border-line p-3.5">
      <div className="flex items-center gap-2">
        <div
          aria-hidden
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[5px]"
          style={{
            background: `color-mix(in srgb, ${color} 13%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 33%, transparent)`,
            color,
          }}
        >
          {iconElement}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-fg">
            {displayName || componentDef.displayName}
          </div>
          <div className="truncate font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
            {componentDef.kind} · {componentDef.type}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label="Collapse detail panel"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <Pill variant={statusVariant} size="xs" className="gap-1">
          <StatusDot variant={statusDotVariant} size={6} halo={false} />
          {statusLabel}
        </Pill>
        {evPerSec !== undefined ? (
          <Pill variant="status" size="xs">
            {evPerSec}
          </Pill>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Test-against-capture (B4 live-tap iteration loop)                  */
/* ------------------------------------------------------------------ */

/**
 * Run the current VRL `source` against a saved tap capture and show the
 * before/after reduction (kept / dropped / event % / byte %). Captures are
 * created from the live-tail panel's "Save capture" affordance.
 */
function TestAgainstCapture({
  pipelineId,
  source,
}: {
  pipelineId: string;
  source: string;
}) {
  const trpc = useTRPC();
  const [captureId, setCaptureId] = useState("");
  const capturesQuery = useQuery(
    trpc.tapCapture.list.queryOptions({ pipelineId }, { enabled: !!pipelineId }),
  );
  const captures = capturesQuery.data ?? [];
  const testMutation = useMutation(trpc.tapCapture.testTransform.mutationOptions());
  const result = testMutation.data;

  const handleTest = () => {
    if (!captureId || !source.trim()) return;
    testMutation.mutate({ pipelineId, captureId, source });
  };

  if (captures.length === 0) {
    return (
      <p className="text-[10.5px] text-fg-2">
        No saved captures yet. Use the live tail&rsquo;s &ldquo;Save capture&rdquo; to
        retain real events, then test changes against them here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <select
          value={captureId}
          onChange={(e) => setCaptureId(e.target.value)}
          aria-label="Select capture"
          className="h-7 min-w-0 flex-1 rounded-[3px] border border-line-2 bg-bg-2 px-2 text-[11px] text-fg"
        >
          <option value="">Select a capture&hellip;</option>
          {captures.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} &middot; {c.componentKey} &middot; {c.eventCount} ev
            </option>
          ))}
        </select>
        <Button
          size="xs"
          variant="secondary"
          disabled={!captureId || !source.trim() || testMutation.isPending}
          onClick={handleTest}
        >
          {testMutation.isPending ? "Testing…" : "Test"}
        </Button>
      </div>

      {testMutation.error && (
        <p className="text-[10.5px] text-status-error">{testMutation.error.message}</p>
      )}

      {result &&
        (result.error ? (
          <p className="rounded-[3px] border border-line bg-bg-1 p-2 font-mono text-[10.5px] text-status-error">
            {result.error}
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 rounded-[3px] border border-line bg-bg-1 p-2 font-mono text-[10.5px] text-fg-1">
            <span>in {result.stats.inputCount}</span>
            <span className="text-status-success">kept {result.stats.outputCount}</span>
            <span className="text-status-error">dropped {result.stats.droppedCount}</span>
            <span>events &minus;{result.stats.eventReductionPercent}%</span>
            <span>bytes &minus;{result.stats.byteReductionPercent}%</span>
          </div>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Simulate tail sampling (A6 trace tail-based sampling preview)      */
/* ------------------------------------------------------------------ */

/**
 * Preview the trace tail-sampler against a saved tap capture and show the
 * kept/dropped traces + projected reduction BEFORE deploying. Tail-sampling is
 * opt-in — nothing is dropped until the pipeline is deployed.
 */
function SimulateTailSample({
  pipelineId,
  config,
}: {
  pipelineId: string;
  config: Record<string, unknown>;
}) {
  const trpc = useTRPC();
  const [captureId, setCaptureId] = useState("");
  const capturesQuery = useQuery(
    trpc.tapCapture.list.queryOptions({ pipelineId }, { enabled: !!pipelineId }),
  );
  const captures = capturesQuery.data ?? [];
  const simulateMutation = useMutation(trpc.vrl.simulateTailSample.mutationOptions());
  const result = simulateMutation.data;

  const handleSimulate = () => {
    if (!captureId) return;
    simulateMutation.mutate({
      pipelineId,
      captureId,
      policy: normalizeTailSampleConfig(config),
    });
  };

  if (captures.length === 0) {
    return (
      <p className="text-[10.5px] text-fg-2">
        No saved captures yet. Use the live tail&rsquo;s &ldquo;Save capture&rdquo; to
        retain real spans, then simulate sampling against them here.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <select
          value={captureId}
          onChange={(e) => setCaptureId(e.target.value)}
          aria-label="Select capture"
          className="h-7 min-w-0 flex-1 rounded-[3px] border border-line-2 bg-bg-2 px-2 text-[11px] text-fg"
        >
          <option value="">Select a capture&hellip;</option>
          {captures.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} &middot; {c.componentKey} &middot; {c.eventCount} ev
            </option>
          ))}
        </select>
        <Button
          size="xs"
          variant="secondary"
          disabled={!captureId || simulateMutation.isPending}
          onClick={handleSimulate}
        >
          {simulateMutation.isPending ? "Simulating…" : "Simulate"}
        </Button>
      </div>

      {simulateMutation.error && (
        <p className="text-[10.5px] text-status-error">{simulateMutation.error.message}</p>
      )}

      {result && (
        <div className="space-y-1 rounded-[3px] border border-line bg-bg-1 p-2 font-mono text-[10.5px] text-fg-1">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{result.totalTraces} traces</span>
            <span className="text-status-success">kept {result.keptTraces}</span>
            <span className="text-status-error">dropped {result.droppedTraces}</span>
            <span>spans &minus;{result.spanReductionPercent}%</span>
            <span>bytes &minus;{result.byteReductionPercent}%</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-fg-2">
            <span>by error {result.keptByPolicy.error}</span>
            <span>by slow {result.keptByPolicy.slow}</span>
            <span>by baseline {result.keptByPolicy.baseline}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface DetailPanelProps {
  pipelineId: string;
  /** Reserved for the upcoming Logs / Metrics tabs (live tail) — currently unused. */
  isDeployed: boolean;
}

export function DetailPanel({ pipelineId }: DetailPanelProps) {
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const copySelectedNodes = useFlowStore((s) => s.copySelectedNodes);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig);
  const updateDisplayName = useFlowStore((s) => s.updateDisplayName);
  const toggleNodeDisabled = useFlowStore((s) => s.toggleNodeDisabled);
  const removeNode = useFlowStore((s) => s.removeNode);
  const replaceNodeComponent = useFlowStore((s) => s.replaceNodeComponent);
  const acceptNodeSharedUpdate = useFlowStore((s) => s.acceptNodeSharedUpdate);
  const unlinkNodeStore = useFlowStore((s) => s.unlinkNode);
  const detailPanelCollapsed = useFlowStore((s) => s.detailPanelCollapsed);
  const toggleDetailPanel = useFlowStore((s) => s.toggleDetailPanel);
  const pipelineVariables = useFlowStore((s) => s.pipelineVariables);

  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const pipelineQuery = useQuery(
    trpc.pipeline.get.queryOptions(
      { id: pipelineId },
      { enabled: !!pipelineId },
    ),
  );
  const environmentId = pipelineQuery.data?.environmentId ?? "";
  const envVarsQuery = useQuery(
    trpc.variable.list.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );
  const envVarNames = useMemo(
    () => new Set((envVarsQuery.data ?? []).map((v: { name: string }) => v.name)),
    [envVarsQuery.data],
  );

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : null;

  const unresolvedVars = useMemo(() => {
    const config = (selectedNode?.data as { config?: Record<string, unknown> } | undefined)?.config ?? {};
    const serverVariables = (pipelineQuery.data?.variables as Record<string, string> | null) ?? {};
    const knownVariables = { ...serverVariables, ...pipelineVariables };
    // Also consider environment-scoped variables as "known"
    const unresolved = new Set<string>();
    const varPattern = /^VAR\[(.+)]$/;

    function walk(obj: unknown) {
      if (typeof obj === "string") {
        const match = obj.match(varPattern);
        if (match) {
          const name = match[1];
          if (!(name in knownVariables) && !envVarNames.has(name)) unresolved.add(name);
        }
      } else if (Array.isArray(obj)) {
        for (const item of obj) walk(item);
      } else if (obj && typeof obj === "object") {
        for (const val of Object.values(obj)) walk(val);
      }
    }

    walk(config);
    return [...unresolved];
  }, [selectedNode, pipelineVariables, pipelineQuery.data?.variables, envVarNames]);

  const isShared = !!selectedNode?.data.sharedComponentId;
  const isStale = isShared &&
    selectedNode?.data.sharedComponentLatestVersion != null &&
    (selectedNode?.data.sharedComponentVersion ?? 0) < selectedNode?.data.sharedComponentLatestVersion;

  const acceptUpdateMutation = useMutation(
    trpc.sharedComponent.acceptUpdate.mutationOptions({
      onSuccess: (data, variables) => {
        // Sync the Zustand store so saveGraph doesn't revert the update
        acceptNodeSharedUpdate(
          variables.nodeId,
          data.config as Record<string, unknown>,
          data.version,
        );
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }) });
        toast.success("Component updated to latest version");
      },
    })
  );

  const unlinkMutation = useMutation(
    trpc.sharedComponent.unlink.mutationOptions({
      onSuccess: (_data, variables) => {
        // Sync the Zustand store so saveGraph doesn't revert the unlink
        unlinkNodeStore(variables.nodeId);
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.get.queryKey({ id: pipelineId }) });
        toast.success("Component unlinked");
      },
    })
  );

  const handleAcceptUpdate = () => {
    if (!selectedNodeId) return;
    acceptUpdateMutation.mutate({ nodeId: selectedNodeId, pipelineId });
  };

  const handleUnlink = () => {
    if (!selectedNodeId) return;
    unlinkMutation.mutate({ nodeId: selectedNodeId, pipelineId });
  };

  const componentKey = (selectedNode?.data as { componentKey?: string })?.componentKey ?? "";
  const currentDisplayName = (selectedNode?.data as { displayName?: string })?.displayName ?? "";

  const upstream = useMemo(
    () =>
      selectedNodeId
        ? getUpstreamSources(selectedNodeId, nodes, edges)
        : { sourceTypes: [], sourceKeys: [] },
    [selectedNodeId, nodes, edges],
  );

  const handleConfigChange = useCallback(
    (values: Record<string, unknown>) => {
      if (selectedNodeId && selectedNode?.data) {
        const nodeData = selectedNode.data as { componentDef?: VectorComponentDef };
        updateNodeConfig(selectedNodeId, values, nodeData.componentDef?.configSchema);
      }
    },
    [selectedNodeId, selectedNode, updateNodeConfig],
  );

  const handleNameChange = useCallback(
    (raw: string) => {
      if (selectedNodeId) {
        const trimmed = raw.slice(0, 64);
        updateDisplayName(selectedNodeId, trimmed);
      }
    },
    [selectedNodeId, updateDisplayName],
  );

  const handleDelete = useCallback(() => {
    if (selectedNodeId) {
      removeNode(selectedNodeId);
    }
  }, [selectedNodeId, removeNode]);

  // ---- Empty selection (no node) ----
  if (!selectedNode) {
    if (detailPanelCollapsed) {
      return (
        <div className="flex w-10 shrink-0 flex-col items-center border-l border-line bg-bg-1 py-2">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleDetailPanel}
            aria-label="Expand detail panel"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
        </div>
      );
    }
    return (
      <div className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-bg-1">
        <div className="flex items-center justify-end px-2 py-1.5 border-b border-line">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={toggleDetailPanel}
            aria-label="Collapse detail panel"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <MousePointerClick className="mb-3 h-7 w-7 text-fg-2" />
          <p className="text-[12.5px] text-fg-1">Select a node to configure it</p>
        </div>
      </div>
    );
  }

  // ---- Collapsed with node selected ----
  if (detailPanelCollapsed) {
    const displayName = (selectedNode.data as { displayName?: string })?.displayName
      ?? (selectedNode.data as { componentDef?: { displayName: string } })?.componentDef?.displayName
      ?? "Node";
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-2 border-l border-line bg-bg-1 py-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={toggleDetailPanel}
          aria-label="Expand detail panel"
        >
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="max-h-40 truncate text-[11px] text-fg-2 [writing-mode:vertical-lr] rotate-180">
          {displayName}
        </span>
      </div>
    );
  }

  // ---- Multi-select state ----
  if (selectedNodeIds.size > 1) {
    return (
      <div className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-bg-1">
        <div className="space-y-3 p-4">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.04em] text-fg-2">
            {selectedNodeIds.size} components selected
          </h3>
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={copySelectedNodes}
            >
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Copy all
            </Button>
            <Button
              variant="destructive"
              size="sm"
              className="w-full"
              onClick={() => {
                selectedNodeIds.forEach((id) => {
                  const node = nodes.find((n) => n.id === id);
                  if (!node?.data?.isSystemLocked) removeNode(id);
                });
              }}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete all
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const {
    componentDef,
    config,
    disabled,
    isSystemLocked,
    metrics: nodeMetrics,
  } = selectedNode.data as {
    componentDef: VectorComponentDef;
    componentKey: string;
    displayName?: string;
    config: Record<string, unknown>;
    disabled?: boolean;
    isSystemLocked?: boolean;
    sharedComponentId?: string;
    sharedComponentName?: string;
    sharedComponentVersion?: number;
    sharedComponentLatestVersion?: number;
    metrics?: { eventsPerSec?: number; status?: string };
  };

  const isReadOnly = isSystemLocked || isShared;
  // UX-1: components of the same kind this node can be swapped to in place.
  // getVectorCatalog() is a cached singleton, so this filter is cheap per render.
  const sameKindComponents = getVectorCatalog().filter(
    (c) => c.kind === componentDef.kind,
  );
  const statusPill = (() => {
    switch (nodeMetrics?.status) {
      case "healthy":
        return {
          statusVariant: "ok" as const,
          statusDotVariant: "healthy" as const,
          statusLabel: "healthy",
        };
      case "degraded":
        return {
          statusVariant: "warn" as const,
          statusDotVariant: "degraded" as const,
          statusLabel: "degraded",
        };
      case "error":
        return {
          statusVariant: "status" as const,
          statusDotVariant: "error" as const,
          statusLabel: "error",
        };
      default:
        return {
          statusVariant: "status" as const,
          statusDotVariant: "idle" as const,
          statusLabel: "idle",
        };
    }
  })();
  const evPerSec =
    nodeMetrics?.eventsPerSec == null
      ? undefined
      : formatEventsRate(nodeMetrics.eventsPerSec);

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-bg-1">
      {/* Header: 26px tile + name + kind + close */}
      <InspectorHeader
        componentDef={componentDef}
        displayName={currentDisplayName}
        evPerSec={evPerSec}
        statusVariant={statusPill.statusVariant}
        statusDotVariant={statusPill.statusDotVariant}
        statusLabel={statusPill.statusLabel}
        onClose={toggleDetailPanel}
      />

      <Tabs defaultValue="config" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList
          variant="line"
          className="w-full shrink-0 justify-start gap-0 border-b border-line px-3.5 py-0 h-auto bg-transparent"
        >
          {(["config", "schema", "metrics", "logs"] as const).map((value) => (
            <TabsTrigger
              key={value}
              value={value}
              className="flex-none rounded-none border-b-2 border-transparent px-2.5 py-2 font-mono text-[11px] uppercase tracking-[0.04em] text-fg-1 data-[state=active]:border-accent-brand data-[state=active]:text-fg data-[state=active]:bg-transparent dark:data-[state=active]:bg-transparent dark:data-[state=active]:border-accent-brand"
            >
              {value}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Config */}
        <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-4 p-3.5">
            {/* ---- System locked banner ---- */}
            {isSystemLocked && (
              <div className="flex items-start gap-2 rounded-[3px] border border-line-2 bg-bg-2 px-3 py-2 text-[12px] text-fg-1">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-info" />
                <span>This source is managed by VectorFlow and cannot be edited.</span>
              </div>
            )}

            {/* ---- Component type switcher (UX-1 replace-kind) ---- */}
            {!isReadOnly &&
              componentDef.type !== LAKE_SINK_TYPE &&
              sameKindComponents.length > 1 && (
                <div className="space-y-1.5">
                  <Label className="text-[12px] text-fg-1">Component type</Label>
                  <Select
                    value={componentDef.type}
                    onValueChange={(type) => {
                      if (!selectedNodeId || type === componentDef.type) return;
                      const next = sameKindComponents.find((c) => c.type === type);
                      if (next) replaceNodeComponent(selectedNodeId, next);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sameKindComponents.map((c) => (
                        <SelectItem key={c.type} value={c.type}>
                          {c.displayName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-fg-1">
                    Switching type keeps connections but resets this node&apos;s
                    configuration.
                  </p>
                </div>
              )}

            {/* ---- Managed Lake sink info banner ---- */}
            {componentDef.type === LAKE_SINK_TYPE && (
              <div className="flex items-start gap-2 rounded-[3px] border border-line-2 bg-bg-2 px-3 py-2 text-[12px] text-fg-1">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-info" />
                <span>
                  Managed storage. Lake volume is tracked separately and does not
                  count toward this pipeline&apos;s egress or cost.
                </span>
              </div>
            )}

            {/* ---- Shared component info banner ---- */}
            {isShared && (
              <div className="flex items-start gap-2 rounded-[3px] border border-line-2 bg-bg-2 px-3 py-2 text-[12px] text-fg-1">
                <LinkIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-brand" />
                <div className="flex-1">
                  <span className="font-medium text-fg">
                    {selectedNode.data.sharedComponentName as string}
                  </span>
                  <p className="mt-0.5 text-[11px] text-fg-2">
                    This component is shared. Config is managed in the Library.
                  </p>
                  <Link
                    href={`/library/shared-components/${selectedNode.data.sharedComponentId as string}`}
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-accent-brand hover:text-accent-brand-2"
                  >
                    Open in Library <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}

            {/* ---- Stale update banner ---- */}
            {isStale && (
              <div className="flex items-start gap-2 rounded-[3px] border border-[color:var(--status-degraded)]/40 bg-[color:var(--status-degraded-bg)] px-3 py-2 text-[12px] text-status-degraded">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="flex-1">
                  <span className="font-medium">Update available</span>
                  <p className="mt-0.5 text-[11px] opacity-80">
                    This shared component has been updated since it was last synced.
                  </p>
                  <div className="mt-2">
                    <Button size="xs" onClick={handleAcceptUpdate}>
                      Accept update
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {unresolvedVars.length > 0 && (
              <div className="flex items-center gap-1.5 rounded bg-yellow-500/10 px-2 py-1 text-xs text-yellow-600 dark:text-yellow-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Unresolved variable{unresolvedVars.length > 1 ? "s" : ""}: {unresolvedVars.join(", ")}
              </div>
            )}

            {/* ---- Identity fields (name + key + enabled + delete) ---- */}
            <div className="space-y-3">
              {/* Name */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="display-name"
                  className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2"
                >
                  Name
                </Label>
                <Input
                  id="display-name"
                  value={currentDisplayName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  disabled={isReadOnly}
                  placeholder="Component name"
                />
              </div>

              {/* Component ID (read-only) */}
              <div className="space-y-1">
                <Label className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">
                  Component ID
                </Label>
                <p className="select-all truncate font-mono text-[11px] text-fg-1">
                  {componentKey}
                </p>
              </div>

              {/* Enabled toggle + Vector docs link */}
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="node-enabled"
                  className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2"
                >
                  Enabled
                </Label>
                <Switch
                  id="node-enabled"
                  checked={!disabled}
                  onCheckedChange={() => {
                    if (selectedNodeId) toggleNodeDisabled(selectedNodeId);
                  }}
                  disabled={isReadOnly}
                />
              </div>

              {/* Action row: docs link + (unlink/delete) */}
              <div className="flex items-center gap-2 pt-1">
                <a
                  href={`https://vector.dev/docs/reference/configuration/${componentDef.kind}s/${componentDef.type}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2 hover:text-fg"
                  aria-label="Open Vector docs"
                >
                  <Book className="h-3 w-3" />
                  Vector docs
                </a>
                <div className="ml-auto flex items-center gap-1">
                  {isShared && !isSystemLocked && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={handleUnlink}
                      title="Unlink from shared component"
                      aria-label="Unlink from shared component"
                    >
                      <Unlink className="h-3 w-3" />
                    </Button>
                  )}
                  {isSystemLocked ? (
                    <span
                      aria-hidden
                      className="inline-flex h-[22px] w-[22px] items-center justify-center text-status-info"
                    >
                      <Lock className="h-3 w-3" />
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={handleDelete}
                      aria-label="Delete component"
                      className="hover:text-status-error"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* ---- Configuration ---- */}
            <div className="space-y-3 border-t border-line pt-3.5">
              {isReadOnly ? (
                /* Read-only config display for locked/shared nodes */
                <div className="space-y-3">
                  {Object.entries(config).map(([key, value]) => (
                    <div key={key} className="space-y-1">
                      <Label className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">
                        {key}
                      </Label>
                      <p className="truncate font-mono text-[11.5px] text-fg">
                        {typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}
                      </p>
                    </div>
                  ))}
                  {Object.keys(config).length === 0 && (
                    <p className="text-[12px] text-fg-2">No configuration</p>
                  )}
                </div>
              ) : (
                <>
                  {/* VRL Editor for remap source field */}
                  {componentDef.type === "remap" && (
                    <>
                    <div className="space-y-1.5">
                      <Label className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">
                        VRL Source
                      </Label>
                      <VrlEditor
                        value={(config.source as string) ?? ""}
                        onChange={(v) => handleConfigChange({ ...config, source: v })}
                        sourceTypes={upstream.sourceTypes}
                        pipelineId={pipelineId}
                        componentKey={componentKey}
                        upstreamSourceKeys={upstream.sourceKeys}
                      />
                    </div>
                      <div className="space-y-1.5 pt-1">
                        <Label className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">
                          Test against capture
                        </Label>
                        <TestAgainstCapture
                          pipelineId={pipelineId}
                          source={(config.source as string) ?? ""}
                        />
                      </div>
                    </>
                  )}

                  {/* VRL Editor for filter condition field */}
                  {componentDef.type === "filter" && (
                    <div className="space-y-1.5">
                      <Label className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">
                        VRL Condition
                      </Label>
                      <VrlEditor
                        value={(config.condition as string) ?? ""}
                        onChange={(v) => handleConfigChange({ ...config, condition: v })}
                        sourceTypes={upstream.sourceTypes}
                        pipelineId={pipelineId}
                        componentKey={componentKey}
                        upstreamSourceKeys={upstream.sourceKeys}
                      />
                    </div>
                  )}

                  {/* VRL Editors for route conditions */}
                  {componentDef.type === "route" && (
                    <div className="space-y-2.5">
                      <Label className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">
                        Route Conditions
                      </Label>
                      {Object.entries(
                        (config.route as Record<string, string>) ?? {},
                      ).map(([routeName, condition]) => (
                        <div key={routeName} className="space-y-1">
                          <Label className="font-mono text-[10px] uppercase tracking-[0.04em] text-fg-2">
                            {routeName}
                          </Label>
                          <VrlEditor
                            value={condition ?? ""}
                            onChange={(v) =>
                              handleConfigChange({
                                ...config,
                                route: {
                                  ...((config.route as Record<string, string>) ?? {}),
                                  [routeName]: v,
                                },
                              })
                            }
                            height="120px"
                            sourceTypes={upstream.sourceTypes}
                            pipelineId={pipelineId}
                            componentKey={componentKey}
                            upstreamSourceKeys={upstream.sourceKeys}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Standard schema form for remaining fields (exclude VRL-managed fields) */}
                  <SchemaForm
                    schema={filterSchema(
                      componentDef.configSchema as {
                        type?: string;
                        properties?: Record<string, Record<string, unknown>>;
                        required?: string[];
                      },
                      componentDef.type,
                    )}
                    values={config}
                    onChange={handleConfigChange}
                    environmentId={environmentId}
                    pipelineId={pipelineId}
                  />

                  {/* Trace tail-sampling: preview kept/dropped traces before deploy */}
                  {componentDef.type === "tail_sample" && (
                    <div className="space-y-1.5 border-t border-line pt-3.5">
                      <Label className="font-mono text-[10.5px] uppercase tracking-[0.04em] text-fg-2">
                        Simulate sampling
                      </Label>
                      <p className="text-[10.5px] text-fg-2">
                        Preview kept/dropped traces on a saved capture before deploying.
                        Tail sampling is opt-in — nothing is dropped until you deploy.
                      </p>
                      <SimulateTailSample pipelineId={pipelineId} config={config} />
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="schema" className="min-h-0 flex-1 overflow-y-auto">
          <InspectorSchemaTab node={selectedNode} nodes={nodes} edges={edges} />
        </TabsContent>

        <TabsContent value="metrics" className="min-h-0 flex-1 overflow-y-auto">
          <InspectorMetricsTab node={selectedNode} />
        </TabsContent>

        <TabsContent value="logs" className="min-h-0 flex-1 overflow-y-auto">
          <InspectorLogsTab pipelineId={pipelineId} node={selectedNode} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
