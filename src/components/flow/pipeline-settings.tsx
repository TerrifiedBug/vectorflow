"use client";

import { useState, useEffect } from "react";
import { ChevronRight, Plus, Trash2, X } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { useFlowStore } from "@/stores/flow-store";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
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

function tagBadgeClass(tag: string): string {
  const upper = tag.toUpperCase();
  if (upper === "PII") return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
  if (upper === "PHI") return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
  if (upper === "PCI-DSS") return "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30";
  if (upper === "INTERNAL") return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
  if (upper === "PUBLIC") return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
  return "bg-muted text-muted-foreground";
}

interface PipelineSettingsProps {
  pipelineId?: string;
}

export function PipelineSettings({ pipelineId }: PipelineSettingsProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const globalConfig = useFlowStore((s) => s.globalConfig);
  const updateGlobalConfig = useFlowStore((s) => s.updateGlobalConfig);
  const setGlobalConfig = useFlowStore((s) => s.setGlobalConfig);
  const currentLogLevel = (globalConfig?.log_level as string) || "info";

  const [jsonOpen, setJsonOpen] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Fetch pipeline to get its tags and resolve team ID
  const pipelineQuery = useQuery(
    trpc.pipeline.get.queryOptions(
      { id: pipelineId! },
      { enabled: !!pipelineId },
    ),
  );
  const pipeline = pipelineQuery.data;
  const teamId = pipeline?.environment?.teamId ?? null;
  const currentTags = (pipeline?.tags as string[]) ?? [];

  // Fetch available tags from the team
  const availableTagsQuery = useQuery(
    trpc.team.getAvailableTags.queryOptions(
      { teamId: teamId! },
      { enabled: !!teamId },
    ),
  );
  const availableTags = availableTagsQuery.data ?? [];

  // Mutation to update pipeline tags (optimistic updates prevent stale-state races)
  const pipelineQueryKey = trpc.pipeline.get.queryKey({ id: pipelineId! });
  const updateTagsMutation = useMutation(
    trpc.pipeline.update.mutationOptions({
      onMutate: async (variables) => {
        await queryClient.cancelQueries({ queryKey: pipelineQueryKey });
        const previous = queryClient.getQueryData(pipelineQueryKey);
        queryClient.setQueryData(pipelineQueryKey, (old: typeof pipeline) =>
          old ? { ...old, tags: (variables.tags ?? old.tags) } : old,
        );
        return { previous };
      },
      onError: (error, _variables, context) => {
        if (context?.previous) {
          queryClient.setQueryData(pipelineQueryKey, context.previous);
        }
        toast.error(error.message || "Failed to update tags");
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: pipelineQueryKey });
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.list.queryKey() });
      },
      onSuccess: () => {
        toast.success("Tags updated");
      },
    }),
  );

  const updateEnrichMutation = useMutation(
    trpc.pipeline.update.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: pipelineQueryKey });
        toast.success("Metadata enrichment updated");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to update enrichment setting");
      },
    }),
  );

  const handleAddTag = (tag: string) => {
    if (!pipelineId || currentTags.includes(tag)) return;
    const newTags = [...currentTags, tag];
    updateTagsMutation.mutate({ id: pipelineId, tags: newTags });
  };

  const handleRemoveTag = (tag: string) => {
    if (!pipelineId) return;
    const newTags = currentTags.filter((t) => t !== tag);
    updateTagsMutation.mutate({ id: pipelineId, tags: newTags });
  };

  // Derive the config object minus log_level for the JSON editor
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { log_level, ...rest } = globalConfig ?? {};
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const unselectedTags = availableTags.filter((t) => !currentTags.includes(t));

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

      {/* Metadata Enrichment */}
      {pipelineId && (
        <>
          <Separator />
          <div className="flex items-center justify-between">
            <div>
              <Label>Enrich with VectorFlow metadata</Label>
              <p className="text-xs text-muted-foreground mt-1">
                Adds <code>.vectorflow.environment</code> and <code>.vectorflow.pipeline_version</code> fields to all events before they reach sinks.
              </p>
            </div>
            <Switch
              checked={pipeline?.enrichMetadata ?? false}
              onCheckedChange={(checked) => {
                if (!pipelineId) return;
                updateEnrichMutation.mutate({ id: pipelineId, enrichMetadata: checked });
              }}
            />
          </div>
        </>
      )}

      {/* Classification Tags */}
      {pipelineId && (availableTags.length > 0 || currentTags.length > 0) && (
        <>
          <Separator />
          <div className="space-y-2">
            <Label>Classification Tags</Label>
            <div className="flex flex-wrap gap-1.5">
              {currentTags.map((tag) => (
                <Badge
                  key={tag}
                  variant="outline"
                  className={`text-xs ${tagBadgeClass(tag)}`}
                >
                  {tag}
                  <button
                    type="button"
                    className="ml-1 inline-flex items-center rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                    onClick={() => handleRemoveTag(tag)}
                    disabled={updateTagsMutation.isPending}
                    aria-label={`Remove ${tag} tag`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {currentTags.length === 0 && (
                <span className="text-xs text-muted-foreground">No tags assigned</span>
              )}
            </div>
            {unselectedTags.length > 0 && (
              <Select
                value=""
                onValueChange={handleAddTag}
                disabled={updateTagsMutation.isPending}
              >
                <SelectTrigger className="w-full text-xs h-8">
                  <SelectValue placeholder="Add a tag..." />
                </SelectTrigger>
                <SelectContent>
                  {unselectedTags.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </>
      )}

      <Separator />

      {/* Global Configuration JSON */}
      <Collapsible open={jsonOpen} onOpenChange={setJsonOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-semibold">
          <ChevronRight
            className={`h-4 w-4 transition-transform ${jsonOpen ? "rotate-90" : ""}`}
          />
          Global Configuration (JSON)
          {hasJsonContent && (
            <Badge variant="secondary" className="ml-auto text-xs">
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

      {pipelineId && (
        <>
          <Separator />
          <SliSettings pipelineId={pipelineId} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SLI settings sub-component
// ---------------------------------------------------------------------------

const METRIC_OPTIONS = [
  { value: "error_rate", label: "Error Rate" },
  { value: "throughput_floor", label: "Throughput Floor" },
  { value: "discard_rate", label: "Discard Rate" },
] as const;

const CONDITION_OPTIONS = [
  { value: "lt", label: "< (less than)" },
  { value: "gt", label: "> (greater than)" },
] as const;

function SliSettings({ pipelineId }: { pipelineId: string }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const slisQuery = useQuery(
    trpc.pipeline.listSlis.queryOptions({ pipelineId }),
  );
  const slis = slisQuery.data ?? [];

  const [sliOpen, setSliOpen] = useState(false);
  const [newMetric, setNewMetric] = useState<string>("error_rate");
  const [newCondition, setNewCondition] = useState<string>("lt");
  const [newThreshold, setNewThreshold] = useState("0.01");
  const [newWindow, setNewWindow] = useState("5");

  const upsertMutation = useMutation(
    trpc.pipeline.upsertSli.mutationOptions({
      onSuccess: () => {
        toast.success("SLI saved");
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.listSlis.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.health.queryKey(),
        });
      },
      onError: (err) => toast.error(err.message || "Failed to save SLI"),
    }),
  );

  const deleteMutation = useMutation(
    trpc.pipeline.deleteSli.mutationOptions({
      onSuccess: () => {
        toast.success("SLI removed");
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.listSlis.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.health.queryKey(),
        });
      },
      onError: (err) => toast.error(err.message || "Failed to delete SLI"),
    }),
  );

  const handleAdd = () => {
    const threshold = parseFloat(newThreshold);
    const windowMinutes = parseInt(newWindow, 10);
    if (isNaN(threshold) || threshold < 0) {
      toast.error("Threshold must be a non-negative number");
      return;
    }
    if (isNaN(windowMinutes) || windowMinutes < 1) {
      toast.error("Window must be at least 1 minute");
      return;
    }
    upsertMutation.mutate({
      pipelineId,
      metric: newMetric as "error_rate" | "throughput_floor" | "discard_rate",
      condition: newCondition as "lt" | "gt",
      threshold,
      windowMinutes,
    });
  };

  const metricLabel = (m: string) =>
    METRIC_OPTIONS.find((o) => o.value === m)?.label ?? m;

  return (
    <Collapsible open={sliOpen} onOpenChange={setSliOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 text-sm font-semibold">
        <ChevronRight
          className={`h-4 w-4 transition-transform ${sliOpen ? "rotate-90" : ""}`}
        />
        Health SLIs
        {slis.length > 0 && (
          <Badge variant="secondary" className="ml-auto text-xs">
            {slis.length}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-3">
        {/* Existing SLIs */}
        {slis.length > 0 && (
          <div className="space-y-2">
            {slis.map((sli) => (
              <div
                key={sli.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-medium">{metricLabel(sli.metric)}</span>{" "}
                  <span className="text-muted-foreground">
                    {sli.condition === "lt" ? "<" : ">"} {sli.threshold}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    ({sli.windowMinutes}m)
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate({ id: sli.id, pipelineId })}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add new SLI form */}
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <div className="space-y-1">
            <Label className="text-xs">Metric</Label>
            <Select value={newMetric} onValueChange={setNewMetric}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRIC_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Condition</Label>
              <Select value={newCondition} onValueChange={setNewCondition}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Threshold</Label>
              <Input
                type="number"
                step="any"
                min="0"
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Window (minutes)</Label>
            <Input
              type="number"
              min="1"
              max="1440"
              value={newWindow}
              onChange={(e) => setNewWindow(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={upsertMutation.isPending}
            className="w-full gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            {upsertMutation.isPending ? "Saving..." : "Add SLI"}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
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
