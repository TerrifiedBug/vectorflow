"use client";

import { createElement, useCallback, useMemo } from "react";
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
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { useFlowStore } from "@/stores/flow-store";
import { SchemaForm } from "@/components/config-forms/schema-form";
import { VrlEditor } from "@/components/vrl-editor/vrl-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Pill } from "@/components/ui/pill";
import { StatusDot } from "@/components/ui/status-dot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { getIcon } from "@/components/flow/node-icon";
import type { VectorComponentDef } from "@/lib/vector/types";
import type { Node, Edge } from "@xyflow/react";

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
  onClose: () => void;
}

function InspectorHeader({
  componentDef,
  displayName,
  evPerSec,
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
          <div className="truncate font-mono text-[10px] uppercase tracking-[0.05em] text-fg-2">
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
        <Pill variant="ok" size="xs" className="gap-1">
          <StatusDot variant="healthy" size={6} halo={false} />
          healthy
        </Pill>
        {evPerSec && (
          <Pill variant="status" size="xs">
            {evPerSec} ev/s
          </Pill>
        )}
      </div>
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
  const acceptNodeSharedUpdate = useFlowStore((s) => s.acceptNodeSharedUpdate);
  const unlinkNodeStore = useFlowStore((s) => s.unlinkNode);
  const detailPanelCollapsed = useFlowStore((s) => s.detailPanelCollapsed);
  const toggleDetailPanel = useFlowStore((s) => s.toggleDetailPanel);

  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : null;

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

  const { componentDef, config, disabled, isSystemLocked } = selectedNode.data as {
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
  };

  const isReadOnly = isSystemLocked || isShared;

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-line bg-bg-1">
      {/* Header: 26px tile + name + kind + close */}
      <InspectorHeader
        componentDef={componentDef}
        displayName={currentDisplayName}
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
                  />
                </>
              )}
            </div>
          </div>
        </TabsContent>

        {/* Schema — coming soon */}
        <TabsContent value="schema" className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState
            compact
            title="Schema inspector coming soon"
            description="Field lineage and inferred schema will live here."
            className="m-3.5"
          />
        </TabsContent>

        {/* Metrics — coming soon */}
        <TabsContent value="metrics" className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState
            compact
            title="Metrics coming soon"
            description="Per-component throughput, error rate, and latency."
            className="m-3.5"
          />
        </TabsContent>

        {/* Logs — coming soon */}
        <TabsContent value="logs" className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState
            compact
            title="Logs coming soon"
            description="Live tail and recent component log events."
            className="m-3.5"
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
