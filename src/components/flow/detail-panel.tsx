"use client";

import { useCallback } from "react";
import { useFlowStore } from "@/stores/flow-store";
import { SchemaForm } from "@/components/config-forms/schema-form";
import { VrlEditor } from "@/components/vrl-editor/vrl-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { VectorComponentDef } from "@/lib/vector/types";

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
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function DetailPanel() {
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const nodes = useFlowStore((s) => s.nodes);
  const updateNodeConfig = useFlowStore((s) => s.updateNodeConfig);
  const updateNodeKey = useFlowStore((s) => s.updateNodeKey);

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

  // ---- Empty state ----
  if (!selectedNode) {
    return (
      <div className="flex h-full w-80 shrink-0 items-center justify-center border-l bg-muted/30 p-6">
        <p className="text-sm text-muted-foreground">
          Select a node to edit
        </p>
      </div>
    );
  }

  const { componentDef, componentKey, config } = selectedNode.data as {
    componentDef: VectorComponentDef;
    componentKey: string;
    config: Record<string, unknown>;
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l bg-background">
      <ScrollArea className="flex-1">
        <div className="space-y-6 p-4">
          {/* ---- Header ---- */}
          <Card className="gap-4 py-4">
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="truncate text-base">
                  {componentDef.displayName}
                </CardTitle>
                <Badge
                  variant="secondary"
                  className={kindVariant[componentDef.kind] ?? ""}
                >
                  {componentDef.kind}
                </Badge>
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
            <SchemaForm
              schema={componentDef.configSchema as {
                type?: string;
                properties?: Record<string, Record<string, unknown>>;
                required?: string[];
              }}
              values={config}
              onChange={handleConfigChange}
            />
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
