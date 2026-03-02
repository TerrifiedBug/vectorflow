"use client";

import { useCallback, useState, useEffect } from "react";
import { Copy, Trash2, ChevronRight } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { VectorComponentDef } from "@/lib/vector/types";
import type { NodeMetricsData } from "@/stores/flow-store";
import { cn } from "@/lib/utils";

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
/*  Helper: human-readable byte rate                                   */
/* ------------------------------------------------------------------ */

function formatBytes(v: number): string {
  if (v >= 1_048_576) return `${(v / 1_048_576).toFixed(1)} MB`;
  if (v >= 1_024) return `${(v / 1_024).toFixed(1)} KB`;
  return `${Math.round(v)} B`;
}

/* ------------------------------------------------------------------ */
/*  Pipeline Settings (shown when no node is selected)                 */
/* ------------------------------------------------------------------ */

function PipelineSettings() {
  const globalConfig = useFlowStore((s) => s.globalConfig);
  const updateGlobalConfig = useFlowStore((s) => s.updateGlobalConfig);
  const setGlobalConfig = useFlowStore((s) => s.setGlobalConfig);
  const currentLogLevel = (globalConfig?.log_level as string) || "info";

  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Derive the config object minus log_level for the JSON editor
  useEffect(() => {
    const { log_level, ...rest } = globalConfig ?? {};
    setJsonText(
      Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : "",
    );
    setJsonError(null);
  }, [globalConfig]);

  const handleApply = () => {
    const trimmed = jsonText.trim();
    if (trimmed === "") {
      // Clear everything except log_level
      if (currentLogLevel !== "info") {
        setGlobalConfig({ log_level: currentLogLevel });
      } else {
        setGlobalConfig(null);
      }
      setJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setJsonError("Must be a JSON object");
        return;
      }
      // Merge back log_level if set
      const merged: Record<string, unknown> = { ...parsed };
      if (currentLogLevel !== "info") {
        merged.log_level = currentLogLevel;
      }
      setGlobalConfig(merged);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const hasJsonContent = jsonText.trim().length > 0;

  return (
    <div className="space-y-6 p-4">
      <h3 className="text-sm font-semibold">Pipeline Settings</h3>

      {/* Log Level */}
      <div className="space-y-2">
        <Label htmlFor="log-level">Log Level</Label>
        <Select
          value={currentLogLevel}
          onValueChange={(value) =>
            updateGlobalConfig("log_level", value === "info" ? undefined : value)
          }
        >
          <SelectTrigger id="log-level" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["trace", "debug", "info", "warn", "error"] as const).map(
              (level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Global Configuration JSON */}
      <Collapsible open={jsonOpen} onOpenChange={setJsonOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-semibold">
          <ChevronRight
            className={`h-4 w-4 transition-transform ${jsonOpen ? "rotate-90" : ""}`}
          />
          Global Configuration (JSON)
          {hasJsonContent && (
            <Badge variant="secondary" className="ml-auto text-[10px]">
              configured
            </Badge>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-3">
          <textarea
            className="min-h-[120px] w-full rounded-md border bg-muted/50 p-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setJsonError(null);
            }}
            placeholder='{ "enrichment_tables": { ... } }'
            spellCheck={false}
          />
          {jsonError && (
            <p className="text-xs text-destructive">{jsonError}</p>
          )}
          <Button size="sm" onClick={handleApply}>
            Apply
          </Button>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DetailPanel() {
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const selectedNodeIds = useFlowStore((s) => s.selectedNodeIds);
  const copySelectedNodes = useFlowStore((s) => s.copySelectedNodes);
  const nodes = useFlowStore((s) => s.nodes);
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig);
  const updateNodeKey = useFlowStore((s) => s.updateNodeKey);
  const toggleNodeDisabled = useFlowStore((s) => s.toggleNodeDisabled);
  const removeNode = useFlowStore((s) => s.removeNode);

  const selectedNode = selectedNodeId
    ? nodes.find((n) => n.id === selectedNodeId)
    : null;

  const handleConfigChange = useCallback(
    (values: Record<string, unknown>) => {
      if (selectedNodeId) {
        updateNodeConfig(selectedNodeId, values);
      }
    },
    [selectedNodeId, updateNodeConfig],
  );

  const handleKeyChange = useCallback(
    (key: string) => {
      if (selectedNodeId) {
        updateNodeKey(selectedNodeId, key);
      }
    },
    [selectedNodeId, updateNodeKey],
  );

  const handleDelete = useCallback(() => {
    if (selectedNodeId) {
      removeNode(selectedNodeId);
    }
  }, [selectedNodeId, removeNode]);

  // ---- Empty state → Pipeline Settings ----
  if (!selectedNode) {
    return (
      <div className="flex h-full w-80 shrink-0 flex-col border-l bg-muted/30">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PipelineSettings />
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
                selectedNodeIds.forEach((id) => removeNode(id));
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

  const { componentDef, componentKey, config, disabled, metrics } = selectedNode.data as {
    componentDef: VectorComponentDef;
    componentKey: string;
    config: Record<string, unknown>;
    disabled?: boolean;
    metrics?: NodeMetricsData;
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 p-4">
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Component Key */}
              <div className="space-y-2">
                <Label htmlFor="component-key">Component Key</Label>
                <Input
                  id="component-key"
                  value={componentKey}
                  onChange={(e) => handleKeyChange(e.target.value)}
                />
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
                />
              </div>

              {/* Component Type (read-only) */}
              <div className="space-y-1">
                <Label className="text-muted-foreground">Type</Label>
                <p className="text-sm">{componentDef.type}</p>
              </div>
            </CardContent>
          </Card>

          {/* Live metrics (only shown when pipeline is deployed) */}
          {metrics && (
            <Card>
              <CardContent className="pt-4">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Events/s</p>
                    <p className="font-mono font-medium">{metrics.eventsPerSec.toFixed(1)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Bytes/s</p>
                    <p className="font-mono font-medium">{formatBytes(metrics.bytesPerSec)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className={cn("font-medium", metrics.status === "healthy" ? "text-green-600" : "text-yellow-600")}>
                      {metrics.status}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* ---- Configuration ---- */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Configuration</h3>

            {/* VRL Editor for remap source field */}
            {componentDef.type === "remap" && (
              <div className="space-y-2">
                <Label>VRL Source</Label>
                <VrlEditor
                  value={(config.source as string) ?? ""}
                  onChange={(v) => handleConfigChange({ ...config, source: v })}
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
          </div>
        </div>
      </div>
    </div>
  );
}
