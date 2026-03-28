"use client";

import { useCallback, useMemo } from "react";
import { Copy, Trash2, Lock, Info, MousePointerClick, Book, Link2 as LinkIcon, Unlink, AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { useFlowStore } from "@/stores/flow-store";
import { SchemaForm } from "@/components/config-forms/schema-form";
import { VrlEditor } from "@/components/vrl-editor/vrl-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveTailPanel } from "@/components/flow/live-tail-panel";
import type { VectorComponentDef } from "@/lib/vector/types";
import type { Node, Edge } from "@xyflow/react";

/* ------------------------------------------------------------------ */
/*  Kind badge styling                                                 */
/* ------------------------------------------------------------------ */

const kindVariant: Record<string, string> = {
  source:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  transform:
    "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  sink: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
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
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface DetailPanelProps {
  pipelineId: string;
  isDeployed: boolean;
}

export function DetailPanel({ pipelineId, isDeployed }: DetailPanelProps) {
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

  if (!selectedNode) {
    return (
      <div className="flex h-full w-80 shrink-0 flex-col border-l bg-muted/30">
        <div className="flex flex-col items-center justify-center h-full text-center p-6">
          <MousePointerClick className="h-8 w-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            Select a node to configure it
          </p>
        </div>
      </div>
    );
  }

  // ---- Multi-select state ----
  if (selectedNodeIds.size > 1) {
    return (
      <div className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
        <div className="space-y-4 p-4">
          <h3 className="text-sm font-semibold">
            {selectedNodeIds.size} components selected
          </h3>
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={copySelectedNodes}
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy All
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
              <Trash2 className="mr-2 h-4 w-4" />
              Delete All
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
    <div className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      <Tabs defaultValue="config" className="flex min-h-0 flex-1 flex-col">
        <TabsList variant="line" className="w-full shrink-0 justify-start border-b px-2">
          <TabsTrigger value="config" className="text-xs">Config</TabsTrigger>
          <TabsTrigger value="live-tail" className="text-xs">Live Tail</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-6 p-4">
            {/* ---- System locked banner ---- */}
            {isSystemLocked && (
              <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>This source is managed by VectorFlow and cannot be edited.</span>
              </div>
            )}

            {/* ---- Shared component info banner ---- */}
            {isShared && (
              <div className="flex items-start gap-2 rounded-md border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-800 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300">
                <LinkIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <span className="font-medium">{selectedNode.data.sharedComponentName as string}</span>
                  <p className="mt-0.5 text-xs opacity-80">
                    This component is shared. Config is managed in the Library.
                  </p>
                  <Link
                    href={`/library/shared-components/${selectedNode.data.sharedComponentId as string}`}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-purple-700 hover:text-purple-900 dark:text-purple-400 dark:hover:text-purple-200"
                  >
                    Open in Library <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}

            {/* ---- Stale update banner ---- */}
            {isStale && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <span className="font-medium">Update available</span>
                  <p className="mt-0.5 text-xs opacity-80">
                    This shared component has been updated since it was last synced.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={handleAcceptUpdate}
                    >
                      Accept update
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ---- Header ---- */}
            <Card className="gap-4 py-4">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-1.5 truncate text-base">
                    {componentDef.displayName}
                    <a
                      href={`https://vector.dev/docs/reference/configuration/${componentDef.kind}s/${componentDef.type}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-muted-foreground hover:text-foreground"
                      aria-label="Open Vector docs"
                    >
                      <Book className="h-3.5 w-3.5" />
                    </a>
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="secondary"
                      className={kindVariant[componentDef.kind] ?? ""}
                    >
                      {componentDef.kind}
                    </Badge>
                    {isShared && !isSystemLocked && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={handleUnlink}
                        title="Unlink from shared component"
                      >
                        <Unlink className="h-4 w-4" />
                      </Button>
                    )}
                    {isSystemLocked ? (
                      <div className="flex h-7 w-7 items-center justify-center text-blue-500">
                        <Lock className="h-3.5 w-3.5" />
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                        onClick={handleDelete}
                        aria-label="Delete component"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Name */}
                <div className="space-y-2">
                  <Label htmlFor="display-name">Name</Label>
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
                  <Label className="text-xs text-muted-foreground">Component ID</Label>
                  <p className="text-xs font-mono text-muted-foreground select-all">{componentKey}</p>
                </div>

                {/* Enabled toggle */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="node-enabled">Enabled</Label>
                  <Switch
                    id="node-enabled"
                    checked={!disabled}
                    onCheckedChange={() => {
                      if (selectedNodeId) toggleNodeDisabled(selectedNodeId);
                    }}
                    disabled={isReadOnly}
                  />
                </div>

                {/* Component Type (read-only) */}
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Type</Label>
                  <p className="text-sm">{componentDef.type}</p>
                </div>
              </CardContent>
            </Card>

            <Separator />

            {/* ---- Configuration ---- */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Configuration</h3>

              {isReadOnly ? (
                /* Read-only config display for locked/shared nodes */
                <div className="space-y-3">
                  {Object.entries(config).map(([key, value]) => (
                    <div key={key} className="space-y-1">
                      <Label className="text-muted-foreground">{key}</Label>
                      <p className="truncate text-sm font-mono">
                        {typeof value === "object" ? JSON.stringify(value) : String(value ?? "")}
                      </p>
                    </div>
                  ))}
                  {Object.keys(config).length === 0 && (
                    <p className="text-sm text-muted-foreground">No configuration</p>
                  )}
                </div>
              ) : (
                <>
                  {/* VRL Editor for remap source field */}
                  {componentDef.type === "remap" && (
                    <div className="space-y-2">
                      <Label>VRL Source</Label>
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
                    <div className="space-y-2">
                      <Label>VRL Condition</Label>
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
                    <div className="space-y-3">
                      <Label>Route Conditions</Label>
                      {Object.entries(
                        (config.route as Record<string, string>) ?? {},
                      ).map(([routeName, condition]) => (
                        <div key={routeName} className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">
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

        <TabsContent value="live-tail" className="min-h-0 flex-1 overflow-y-auto">
          <LiveTailPanel
            pipelineId={pipelineId}
            componentKey={componentKey}
            isDeployed={isDeployed}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
