"use client";

import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { useFlowStore } from "@/stores/flow-store";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
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

export function PipelineSettings() {
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
      setGlobalConfig({ log_level: currentLogLevel });
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
      merged.log_level = currentLogLevel;
      setGlobalConfig(merged);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const hasJsonContent = jsonText.trim().length > 0;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Pipeline Settings</h3>

      {/* Log Level */}
      <div className="space-y-2">
        <Label htmlFor="log-level">Log Level</Label>
        <Select
          value={currentLogLevel}
          onValueChange={(value) =>
            updateGlobalConfig("log_level", value)
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

/**
 * Returns true when globalConfig has content beyond just log_level.
 * Used by the toolbar to show a dot indicator on the gear icon.
 */
export function useHasGlobalConfigContent(): boolean {
  const globalConfig = useFlowStore((s) => s.globalConfig);
  if (!globalConfig) return false;
  const keys = Object.keys(globalConfig).filter((k) => k !== "log_level");
  return keys.length > 0;
}
