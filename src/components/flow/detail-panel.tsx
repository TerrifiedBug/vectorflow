"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Trash2, Lock, Info } from "lucide-react";
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
  const updateNodeKey = useFlowStore((s) => s.updateNodeKey);
  const toggleNodeDisabled = useFlowStore((s) => s.toggleNodeDisabled);
  const removeNode = useFlowStore((s) => s.removeNode);

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : null;

  const storeKey = (selectedNode?.data as { componentKey?: string })?.componentKey ?? "";
  const [displayKey, setDisplayKey] = useState(storeKey);

  useEffect(() => {
    setDisplayKey(storeKey);
  }, [storeKey]);

  const upstream = useMemo(
    () =>
      selectedNodeId
        ? getUpstreamSources(selectedNodeId, nodes, edges)
        : { sourceTypes: [], sourceKeys: [] },
    [selectedNodeId, nodes, edges],
  );

  const handleConfigChange = useCallback(
    (values: Record<string, unknown>) => {
      if (selectedNodeId) {
        updateNodeConfig(selectedNodeId, values);
      }
    },
    [selectedNodeId, updateNodeConfig],
  );

  const handleKeyChange = useCallback(
    (raw: string) => {
      if (selectedNodeId) {
        const sanitized = raw
          .replace(/\s+/g, "_")
          .replace(/[^a-zA-Z0-9_]/g, "")
          .replace(/^(\d+)/, "_$1");
        if (sanitized) {
          setDisplayKey(raw);
          updateNodeKey(selectedNodeId, sanitized);
        } else {
          setDisplayKey(storeKey);
        }
      }
    },
    [selectedNodeId, updateNodeKey, storeKey],
  );

  const handleDelete = useCallback(() => {
    if (selectedNodeId) {
      removeNode(selectedNodeId);
    }
  }, [selectedNodeId, removeNode]);

  if (!selectedNode) {
    return (
      <div className="flex h-full w-80 shrink-0 flex-col border-l bg-muted/30">
        <div className="flex flex-1 items-center justify-center">
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
    componentKey: string; // used via displayKey/storeKey above
    config: Record<string, unknown>;
    disabled?: boolean;
    isSystemLocked?: boolean;
  };

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

            {/* ---- Header ---- */}
            <Card className="gap-4 py-4">
              <CardHeader className="pb-0">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate text-base">
                    {componentDef.displayName}
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    <Badge
                      variant="secondary"
                      className={kindVariant[componentDef.kind] ?? ""}
                    >
                      {componentDef.kind}
                    </Badge>
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
                {/* Component Key */}
                <div className="space-y-2">
                  <Label htmlFor="component-key">Component Key</Label>
                  <Input
                    id="component-key"
                    value={displayKey}
                    onChange={(e) => handleKeyChange(e.target.value)}
                    disabled={isSystemLocked}
                  />
                  <p className="text-xs text-muted-foreground">
                    Letters, numbers, and underscores only (e.g. traefik_logs)
                  </p>
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
                    disabled={isSystemLocked}
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

              {isSystemLocked ? (
                /* Read-only config display for locked nodes */
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
