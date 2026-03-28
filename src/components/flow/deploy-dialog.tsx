"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Rocket, CheckCircle, CheckCircle2, XCircle, Loader2, Radio, ChevronsUpDown, Check, X, ShieldCheck, ShieldX, Clock, AlertTriangle } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConfigDiff } from "@/components/ui/config-diff";

interface DeployDialogProps {
  pipelineId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeployDialog({ pipelineId, open, onOpenChange }: DeployDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const [deploying, setDeploying] = useState(false);
  const [changelog, setChangelog] = useState("");
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [labelPopoverOpen, setLabelPopoverOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [stagedDeploy, setStagedDeploy] = useState(false);
  const [healthCheckWindow, setHealthCheckWindow] = useState(5);

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const roleQuery = useQuery({
    ...trpc.team.teamRole.queryOptions({ teamId: selectedTeamId! }),
    enabled: open && !!selectedTeamId,
  });

  const previewQuery = useQuery({
    ...trpc.deploy.preview.queryOptions({ pipelineId }),
    enabled: open,
  });

  const envQuery = useQuery({
    ...trpc.deploy.environmentInfo.queryOptions({ pipelineId }),
    enabled: open,
  });

  const deployWarningsQuery = useQuery({
    ...trpc.pipelineDependency.deployWarnings.queryOptions({ pipelineId }),
    enabled: open,
  });
  const deployWarningsData = deployWarningsQuery.data;

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

  // Fetch pending deploy requests for this pipeline
  const pendingRequestsQuery = useQuery({
    ...trpc.deploy.listPendingRequests.queryOptions({ pipelineId }),
    enabled: open,
  });
  const agentMutation = useMutation(
    trpc.deploy.agent.mutationOptions({
      onSuccess: (result) => {
        setDeploying(false);
        queryClient.invalidateQueries();

        if ("pendingApproval" in result && result.pendingApproval) {
          toast.success("Deploy request submitted", {
            description: "An admin will review your request.",
          });
          onOpenChange(false);
          return;
        }

        if (!result.success) {
          const errorMsg = ("validationErrors" in result && result.validationErrors)
            ? result.validationErrors.map((e: { message: string }) => e.message).join("; ")
            : ("error" in result ? result.error : "Unknown error");
          toast.error("Deploy failed", { description: errorMsg as string , duration: 6000 });
          return;
        }

        toast.success("Pipeline published to agents", {
          description: "versionNumber" in result && result.versionNumber ? `Version v${result.versionNumber}` : undefined,
        });
        if ("gitSyncError" in result && result.gitSyncError) {
          toast.warning("Pipeline deployed but Git sync failed", {
            description: result.gitSyncError,
            duration: 8000,
          });
        }
        onOpenChange(false);
      },
      onError: (err) => {
        setDeploying(false);
        toast.error("Deploy failed", { description: err.message , duration: 6000 });
      },
    })
  );

  const approveMutation = useMutation(
    trpc.deploy.approveDeployRequest.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast.success("Deploy request approved", {
          description: "The request is now ready to be deployed.",
        });
        onOpenChange(false);
      },
      onError: (err) => {
        toast.error("Approval failed", { description: err.message , duration: 6000 });
      },
    })
  );

  const rejectMutation = useMutation(
    trpc.deploy.rejectDeployRequest.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast.success("Deploy request rejected");
        setRejectNote("");
        onOpenChange(false);
      },
      onError: (err) => {
        toast.error("Rejection failed", { description: err.message , duration: 6000 });
      },
    })
  );

  const executeMutation = useMutation(
    trpc.deploy.executeApprovedRequest.mutationOptions({
      onSuccess: (result) => {
        queryClient.invalidateQueries();
        if (!result.success) {
          const errorMsg = ("validationErrors" in result && result.validationErrors)
            ? result.validationErrors.map((e: { message: string }) => e.message).join("; ")
            : ("error" in result ? result.error : "Unknown error");
          toast.error("Deploy failed", { description: errorMsg as string , duration: 6000 });
          return;
        }
        toast.success("Pipeline published to agents", {
          description: "versionNumber" in result && result.versionNumber ? `Version v${result.versionNumber}` : undefined,
        });
        onOpenChange(false);
      },
      onError: (err) => {
        toast.error("Deploy failed", { description: err.message , duration: 6000 });
      },
    })
  );

  const cancelMutation = useMutation(
    trpc.deploy.cancelDeployRequest.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries();
        toast.success("Deploy request cancelled");
        onOpenChange(false);
      },
      onError: (err) => {
        toast.error("Cancel failed", { description: err.message , duration: 6000 });
      },
    })
  );

  const stagedDeployMutation = useMutation(
    trpc.stagedRollout.create.mutationOptions({
      onSuccess: () => {
        setDeploying(false);
        queryClient.invalidateQueries();
        toast.success("Canary deploy started", {
          description: `Deploying to ${matchingNodeCount} canary node${matchingNodeCount !== 1 ? "s" : ""}`,
        });
        onOpenChange(false);
      },
      onError: (err) => {
        setDeploying(false);
        toast.error("Canary deploy failed", { description: err.message , duration: 6000 });
      },
    })
  );

  const env = envQuery.data;
  const preview = previewQuery.data;
  const userRole = roleQuery.data?.role;
  const isLoading = previewQuery.isLoading || envQuery.isLoading || roleQuery.isLoading;
  const isValid = preview?.validation?.valid ?? false;

  const isAdmin = userRole === "ADMIN";
  const requiresApproval = env?.requireDeployApproval && userRole === "EDITOR";
  const adminBypassingApproval = env?.requireDeployApproval && isAdmin;
  const allRequests = pendingRequestsQuery.data ?? [];
  const pendingRequests = allRequests.filter((r) => r.status === "PENDING");
  const approvedRequests = allRequests.filter((r) => r.status === "APPROVED");
  const pendingRequest = pendingRequests[0];
  const approvedRequest = approvedRequests[0];
  const isOwnRequest = pendingRequest?.requestedById === session?.user?.id;
  const canReview = !!pendingRequest && !isOwnRequest && (userRole === "EDITOR" || isAdmin);
  const isReviewMode = canReview;

  const formatRelativeTime = (date: Date | string | null | undefined): string => {
    if (!date) return "";
    const d = typeof date === "string" ? new Date(date) : date;
    const seconds = Math.floor((new Date().getTime() - d.getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const pendingRequestTimeAgo = useMemo(() => {
    if (!pendingRequest) return "";
    return formatRelativeTime(pendingRequest.createdAt);
  }, [pendingRequest]);

  function handleDeploy() {
    setDeploying(true);
    if (stagedDeploy) {
      stagedDeployMutation.mutate({
        pipelineId,
        canarySelector: nodeSelector,
        healthCheckWindowMinutes: healthCheckWindow,
        changelog: changelog.trim(),
      });
      return;
    }
    agentMutation.mutate({
      pipelineId,
      changelog: changelog.trim(),
      ...(selectedLabels.length > 0 ? { nodeSelector } : { nodeSelector: {} }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(val) => { if (deploying) return; if (!val) { setChangelog(""); setSelectedLabels([]); setRejectNote(""); setStagedDeploy(false); setHealthCheckWindow(5); } onOpenChange(val); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isReviewMode ? (
              <>
                <ShieldCheck className="h-5 w-5" />
                Review Deploy Request
              </>
            ) : approvedRequest ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                Deploy Approved Request
              </>
            ) : (
              <>
                <Rocket className="h-5 w-5" />
                {requiresApproval ? "Request Deploy" : "Deploy Pipeline"}
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {isReviewMode
              ? "Review and approve or reject this deploy request."
              : approvedRequest
                ? "This request has been approved and is ready to deploy."
                : requiresApproval
                  ? "This environment requires admin approval for deployments."
                  : "Review and deploy to your environment."
            }
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : isReviewMode && pendingRequest ? (
          /* Review mode for admins */
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{env?.environmentName}</span>
                <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                  <Clock className="mr-1 h-3 w-3" />
                  Pending Approval
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground space-y-1">
                <p>
                  Requested by <span className="font-medium text-foreground">{pendingRequest.requestedBy?.name ?? pendingRequest.requestedBy?.email ?? "Unknown"}</span>
                  {" "}{pendingRequestTimeAgo}
                </p>
                <p>
                  Reason: <span className="italic">{pendingRequest.changelog}</span>
                </p>
              </div>
            </div>

            <Separator />

            {/* Config diff for review */}
            {pendingRequest.configYaml && preview && (
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {preview.currentConfigYaml ? "Changes" : "Generated Config"}
                </span>
                <div className="max-h-48 overflow-y-auto rounded-md">
                  <ConfigDiff
                    oldConfig={preview.currentConfigYaml ?? ""}
                    newConfig={pendingRequest.configYaml}
                    oldLabel={preview.currentVersion != null ? `v${preview.currentVersion}` : "empty"}
                    newLabel="pending"
                  />
                </div>
              </div>
            )}

            {/* Reject note */}
            <div className="space-y-1">
              <label htmlFor="reject-note" className="text-xs font-medium">
                Rejection note (optional)
              </label>
              <Textarea
                id="reject-note"
                placeholder="Reason for rejection..."
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                rows={2}
                className="resize-none text-sm"
              />
            </div>
          </div>
        ) : approvedRequest ? (
          /* Approved request — ready to deploy */
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium">
                  Approved request from {approvedRequest.requestedBy?.name ?? approvedRequest.requestedBy?.email ?? "Unknown"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Approved by {approvedRequest.reviewedBy?.name ?? approvedRequest.reviewedBy?.email ?? "Unknown"} · {formatRelativeTime(approvedRequest.reviewedAt)}
              </p>
              <p className="text-sm">{approvedRequest.changelog}</p>
              {approvedRequest.configYaml && preview && (
                <details className="group">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
                    View config
                  </summary>
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-md">
                    <ConfigDiff
                      oldConfig={preview.currentConfigYaml ?? ""}
                      newConfig={approvedRequest.configYaml}
                      oldLabel={preview.currentVersion != null ? `v${preview.currentVersion}` : "empty"}
                      newLabel="approved"
                    />
                  </div>
                </details>
              )}
              <div className="flex justify-between pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cancelMutation.mutate({ requestId: approvedRequest.id })}
                  disabled={cancelMutation.isPending || executeMutation.isPending}
                >
                  {cancelMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Cancelling...</>
                  ) : (
                    "Cancel Request"
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={() => executeMutation.mutate({ requestId: approvedRequest.id })}
                  disabled={cancelMutation.isPending || executeMutation.isPending}
                >
                  {executeMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deploying...</>
                  ) : (
                    <><Rocket className="mr-2 h-4 w-4" />Deploy Now</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          /* Normal deploy / request mode */
          <div className="space-y-4">
            {env && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{env.environmentName}</span>
                  {requiresApproval && (
                    <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30">
                      Approval required
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {env.nodes.length} node{env.nodes.length !== 1 ? "s" : ""} enrolled — agents will pick up changes on next poll
                </p>
              </div>
            )}

            {adminBypassingApproval && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  This environment requires deploy approval for editors. As an admin, your deploy will proceed immediately.
                </p>
              </div>
            )}

            {deployWarningsData && deployWarningsData.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  <p className="font-medium">Undeployed upstream dependencies:</p>
                  <ul className="mt-1 list-disc list-inside">
                    {deployWarningsData.map(dep => (
                      <li key={dep.upstream.id}>{dep.upstream.name}</li>
                    ))}
                  </ul>
                </div>
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
                          className="ml-0.5 cursor-pointer rounded-full outline-none transition-colors hover:bg-muted"
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

                {/* Staged canary deploy toggle */}
                {selectedLabels.length > 0 && (
                  <div className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between">
                      <label htmlFor="staged-deploy" className="text-xs font-medium">
                        Staged Canary Deploy
                      </label>
                      <Switch
                        id="staged-deploy"
                        size="sm"
                        checked={stagedDeploy}
                        onCheckedChange={setStagedDeploy}
                      />
                    </div>
                    {stagedDeploy && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <label htmlFor="health-window" className="text-xs text-muted-foreground whitespace-nowrap">
                            Health Check Window (min)
                          </label>
                          <Input
                            id="health-window"
                            type="number"
                            min={1}
                            max={60}
                            value={healthCheckWindow}
                            onChange={(e) => setHealthCheckWindow(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                            className="h-7 w-16 text-xs"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {matchingNodeCount} canary node{matchingNodeCount !== 1 ? "s" : ""}, {totalNodeCount - matchingNodeCount} remaining
                        </p>
                      </div>
                    )}
                  </div>
                )}
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
                <div className="max-h-48 overflow-y-auto rounded-md">
                  <ConfigDiff
                    oldConfig={preview.currentConfigYaml ?? ""}
                    newConfig={preview.configYaml}
                    oldLabel={preview.currentVersion != null ? `v${preview.currentVersion}` : "empty"}
                    newLabel="pending"
                  />
                </div>
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
        </div>

        <DialogFooter>
          {approvedRequest && !isReviewMode ? (
            /* Approved request — action buttons are inline above */
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {isReviewMode && pendingRequest ? (
                /* Review mode buttons */
                <>
                  <Button
                    variant="destructive"
                    onClick={() => rejectMutation.mutate({ requestId: pendingRequest.id, note: rejectNote || undefined })}
                    disabled={rejectMutation.isPending || approveMutation.isPending}
                  >
                    {rejectMutation.isPending ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Rejecting...</>
                    ) : (
                      <><ShieldX className="mr-2 h-4 w-4" />Reject</>
                    )}
                  </Button>
                  <Button
                    onClick={() => approveMutation.mutate({ requestId: pendingRequest.id })}
                    disabled={rejectMutation.isPending || approveMutation.isPending}
                  >
                    {approveMutation.isPending ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Approving...</>
                    ) : (
                      <><ShieldCheck className="mr-2 h-4 w-4" />Approve</>
                    )}
                  </Button>
                </>
              ) : (
                /* Normal deploy / request button */
                <Button
                  onClick={handleDeploy}
                  disabled={isLoading || !isValid || deploying || !changelog.trim()}
                >
                  {deploying ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{stagedDeploy ? "Deploying Canary..." : requiresApproval ? "Requesting..." : "Deploying..."}</>
                  ) : stagedDeploy ? (
                    <><Rocket className="mr-2 h-4 w-4" />Deploy to Canary Nodes</>
                  ) : requiresApproval ? (
                    <><Clock className="mr-2 h-4 w-4" />Request Deploy</>
                  ) : (
                    <><Radio className="mr-2 h-4 w-4" />Publish to Agents</>
                  )}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
