"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Rocket, CheckCircle, XCircle, Loader2, Radio, ChevronsUpDown, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ConfigDiff } from "@/components/ui/config-diff";

interface DeployDialogProps {
  pipelineId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeployDialog({ pipelineId, open, onOpenChange }: DeployDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [deploying, setDeploying] = useState(false);
  const [changelog, setChangelog] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [labelPopoverOpen, setLabelPopoverOpen] = useState(false);

  const previewQuery = useQuery({
    ...trpc.deploy.preview.queryOptions({ pipelineId }),
    enabled: open,
  });

  const envQuery = useQuery({
    ...trpc.deploy.environmentInfo.queryOptions({ pipelineId }),
    enabled: open,
  });

  const environmentId = envQuery.data?.environmentId;

  const labelsQuery = useQuery({
    ...trpc.fleet.listLabels.queryOptions(
      { environmentId: environmentId! },
    ),
    enabled: open && !!environmentId,
  });

  // Seed selectedLabels from existing pipeline nodeSelector when dialog opens
  useEffect(() => {
    if (!open) return;
    const existing = previewQuery.data?.nodeSelector ?? {};
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedLabels(
      Object.entries(existing).map(([k, v]) => `${k}=${v}`),
    );
  }, [open, previewQuery.data?.nodeSelector]);

  // Build flat list of "key=value" options from the label map
  const availableLabelOptions = useMemo(() => {
    const data = labelsQuery.data;
    if (!data) return [];
    const options: string[] = [];
    for (const [key, values] of Object.entries(data)) {
      for (const val of values as string[]) {
        options.push(`${key}=${val}`);
      }
    }
    return options.sort();
  }, [labelsQuery.data]);

  // Build nodeSelector from selected labels
  const nodeSelector = useMemo(() => {
    const sel: Record<string, string> = {};
    for (const label of selectedLabels) {
      const idx = label.indexOf("=");
      if (idx > 0) {
        sel[label.slice(0, idx)] = label.slice(idx + 1);
      }
    }
    return sel;
  }, [selectedLabels]);

  // Compute matching node count
  const matchingNodeCount = useMemo(() => {
    const nodes = envQuery.data?.nodes ?? [];
    if (selectedLabels.length === 0) return nodes.length;
    return nodes.filter((n) => {
      const nodeLabels = (n.labels as Record<string, string>) ?? {};
      return Object.entries(nodeSelector).every(
        ([key, value]) => nodeLabels[key] === value,
      );
    }).length;
  }, [envQuery.data?.nodes, selectedLabels, nodeSelector]);

  const totalNodeCount = envQuery.data?.nodes.length ?? 0;

  const agentMutation = useMutation(
    trpc.deploy.agent.mutationOptions({
      onSuccess: (result) => {
        setDeploying(false);
        queryClient.invalidateQueries();

        if (!result.success) {
          const errorMsg = result.validationErrors?.map((e: { message: string }) => e.message).join("; ")
            || result.error
            || "Unknown error";
          toast.error("Deploy failed", { description: errorMsg });
          return;
        }

        toast.success("Pipeline published to agents", {
          description: result.versionNumber ? `Version v${result.versionNumber}` : undefined,
        });
        if (result.gitSyncError) {
          toast.warning("Pipeline deployed but Git sync failed", {
            description: result.gitSyncError,
            duration: 8000,
          });
        }
        onOpenChange(false);
      },
      onError: (err) => {
        setDeploying(false);
        toast.error("Deploy failed", { description: err.message });
      },
    })
  );

  const env = envQuery.data;
  const preview = previewQuery.data;
  const isLoading = previewQuery.isLoading || envQuery.isLoading;
  const isValid = preview?.validation?.valid ?? false;

  function handleDeploy() {
    setDeploying(true);
    agentMutation.mutate({
      pipelineId,
      changelog: changelog.trim(),
      ...(selectedLabels.length > 0 ? { nodeSelector } : { nodeSelector: {} }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(val) => { if (deploying) return; if (!val) { setChangelog(""); setSelectedLabels([]); } onOpenChange(val); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            Deploy Pipeline
          </DialogTitle>
          <DialogDescription>
            Review and deploy to your environment.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {env && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{env.environmentName}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {env.nodes.length} node{env.nodes.length !== 1 ? "s" : ""} enrolled — agents will pick up changes on next poll
                </p>
              </div>
            )}

            {/* Node selector */}
            {availableLabelOptions.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium">Target Nodes (optional)</label>
                <Popover open={labelPopoverOpen} onOpenChange={setLabelPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={labelPopoverOpen}
                      className="w-full justify-between font-normal"
                    >
                      {selectedLabels.length > 0
                        ? `${selectedLabels.length} label${selectedLabels.length !== 1 ? "s" : ""} selected`
                        : "All nodes (no filter)"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                    <Command>
                      <CommandInput placeholder="Search labels..." />
                      <CommandList>
                        <CommandEmpty>No labels found.</CommandEmpty>
                        <CommandGroup>
                          {(() => {
                            const selectedKeys = new Set(selectedLabels.map((l) => l.split("=")[0]));
                            return availableLabelOptions.map((option) => {
                              const optionKey = option.split("=")[0];
                              const isSelected = selectedLabels.includes(option);
                              const keyAlreadyUsed = selectedKeys.has(optionKey) && !isSelected;
                              return (
                                <CommandItem
                                  key={option}
                                  value={option}
                                  disabled={keyAlreadyUsed}
                                  onSelect={() => {
                                    if (keyAlreadyUsed) return;
                                    setSelectedLabels((prev) =>
                                      prev.includes(option)
                                        ? prev.filter((l) => l !== option)
                                        : [...prev, option],
                                    );
                                  }}
                                >
                                  <Check
                                    className={`mr-2 h-4 w-4 ${
                                      isSelected
                                        ? "opacity-100"
                                        : "opacity-0"
                                    }`}
                                  />
                                  {option}
                                </CommandItem>
                              );
                            });
                          })()}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>

                {selectedLabels.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedLabels.map((label) => (
                      <Badge key={label} variant="secondary" className="gap-1">
                        {label}
                        <button
                          type="button"
                          className="ml-0.5 rounded-full outline-none hover:bg-muted"
                          onClick={() =>
                            setSelectedLabels((prev) =>
                              prev.filter((l) => l !== label),
                            )
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {matchingNodeCount} of {totalNodeCount} node{totalNodeCount !== 1 ? "s" : ""} match
                </p>
              </div>
            )}

            <Separator />

            {preview && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  {isValid ? (
                    <CheckCircle className="h-4 w-4 text-green-500" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" />
                  )}
                  <span className="text-sm font-medium">
                    {isValid ? "Config is valid" : "Validation failed"}
                  </span>
                </div>
                {!isValid && preview.validation?.errors && (
                  <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                    {preview.validation.errors.map((e: { message: string }, i: number) => (
                      <p key={i}>{e.message}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {preview?.configYaml && (
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {preview.currentConfigYaml ? "Changes" : "Generated Config"}
                </span>
                <ConfigDiff
                  oldConfig={preview.currentConfigYaml ?? ""}
                  newConfig={preview.configYaml}
                  oldLabel={preview.currentVersion != null ? `v${preview.currentVersion}` : "empty"}
                  newLabel="pending"
                />
              </div>
            )}

            {preview?.currentLogLevel !== preview?.newLogLevel && (
              <div className="rounded-md bg-muted p-2 text-xs">
                Log level: <span className="line-through text-muted-foreground">{preview?.currentLogLevel ?? "info"}</span>
                {" → "}
                <span className="font-medium">{preview?.newLogLevel ?? "info"}</span>
              </div>
            )}

            {preview?.currentVersion !== null && preview?.currentVersion !== undefined && (
              <p className="text-xs text-muted-foreground">
                Current deployed version: v{preview.currentVersion}
              </p>
            )}

            {/* Deployment reason (required) */}
            <div className="space-y-1">
              <label htmlFor="changelog" className="text-xs font-medium">
                Deployment Reason <span className="text-destructive">*</span>
              </label>
              <Textarea
                id="changelog"
                placeholder="What changed and why? e.g., Added rate limiting to reduce Datadog ingestion costs"
                value={changelog}
                onChange={(e) => setChangelog(e.target.value)}
                rows={3}
                className="resize-none text-sm"
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleDeploy}
            disabled={isLoading || !isValid || deploying || !changelog.trim()}
          >
            {deploying ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deploying...</>
            ) : (
              <><Radio className="mr-2 h-4 w-4" />Publish to Agents</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
