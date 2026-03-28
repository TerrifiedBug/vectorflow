"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { toast } from "sonner";
import {
  Loader2,
  AlertTriangle,
  CheckCircle,
  Clock,
  ArrowRight,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfigDiff } from "@/components/ui/config-diff";

type Step = "target" | "preflight" | "diff" | "confirm" | "result";

interface PromoteResult {
  requestId: string;
  status: string;
  pendingApproval: boolean;
}

interface PromotePipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: { id: string; name: string; environmentId: string };
}

export function PromotePipelineDialog({
  open,
  onOpenChange,
  pipeline,
}: PromotePipelineDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const [step, setStep] = useState<Step>("target");
  const [targetEnvId, setTargetEnvId] = useState("");
  const [name, setName] = useState(pipeline.name);
  const [result, setResult] = useState<PromoteResult | null>(null);

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId && open }
    )
  );

  const availableEnvironments = (environmentsQuery.data ?? []).filter(
    (env) => env.id !== pipeline.environmentId
  );

  const selectedEnv = availableEnvironments.find((e) => e.id === targetEnvId);

  // Step 2: Preflight check
  const preflightQuery = useQuery(
    trpc.promotion.preflight.queryOptions(
      { pipelineId: pipeline.id, targetEnvironmentId: targetEnvId, name },
      { enabled: step === "preflight" && !!targetEnvId }
    )
  );

  // Step 3: Diff preview
  const diffQuery = useQuery(
    trpc.promotion.diffPreview.queryOptions(
      { pipelineId: pipeline.id },
      { enabled: step === "diff" }
    )
  );

  // Step 4: Initiate mutation
  const initiateMutation = useMutation(
    trpc.promotion.initiate.mutationOptions({
      onSuccess: (data) => {
        setResult(data);
        setStep("result");
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.promotion.history.queryKey({ pipelineId: pipeline.id }),
        });
      },
      onError: (err) => {
        toast.error(err.message || "Failed to initiate promotion", { duration: 6000 });
        setStep("diff");
      },
    })
  );

  const handleClose = (openState: boolean) => {
    if (!openState) {
      setStep("target");
      setTargetEnvId("");
      setName(pipeline.name);
      setResult(null);
    }
    onOpenChange(openState);
  };

  const handleConfirmPromotion = () => {
    setStep("confirm");
    initiateMutation.mutate({
      pipelineId: pipeline.id,
      targetEnvironmentId: targetEnvId,
      name: name || undefined,
    });
  };

  // Step 1: Target selection
  if (step === "target") {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote Pipeline</DialogTitle>
            <DialogDescription>
              Promote this pipeline to another environment with preflight validation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="promote-target-env">Target Environment</Label>
              <Select value={targetEnvId} onValueChange={setTargetEnvId}>
                <SelectTrigger id="promote-target-env" className="w-full">
                  <SelectValue placeholder="Select environment..." />
                </SelectTrigger>
                <SelectContent>
                  {availableEnvironments.map((env) => (
                    <SelectItem key={env.id} value={env.id}>
                      {env.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="promote-pipeline-name">Pipeline Name</Label>
              <Input
                id="promote-pipeline-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => handleClose(false)}>
              Cancel
            </Button>
            <Button
              disabled={!targetEnvId}
              onClick={() => setStep("preflight")}
            >
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Step 2: Preflight check
  if (step === "preflight") {
    const preflight = preflightQuery.data;
    const isLoading = preflightQuery.isLoading;
    const canProceed = preflight?.canProceed ?? false;
    const missing = preflight?.missing ?? [];
    const present = preflight?.present ?? [];
    const nameCollision = preflight?.nameCollision ?? false;

    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preflight Check</DialogTitle>
            <DialogDescription>
              Validating secret references in the target environment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking secret references...
              </div>
            ) : (
              <>
                {missing.length > 0 && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive shrink-0" />
                      <div className="text-sm text-destructive">
                        <p className="font-medium mb-1">
                          The following secrets are missing in the target environment and must be
                          created before promotion can proceed:
                        </p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {missing.map((s) => (
                            <li key={s}>
                              <code className="text-xs">{s}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {nameCollision && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <p className="text-sm text-amber-800 dark:text-amber-300">
                        A pipeline named &quot;{name}&quot; already exists in the target environment.
                        Go back and change the pipeline name to proceed.
                      </p>
                    </div>
                  </div>
                )}

                {canProceed && !nameCollision && (
                  <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
                      <p className="text-sm text-green-800 dark:text-green-300">
                        {present.length === 0
                          ? "No secret references in this pipeline."
                          : `All ${present.length} secret reference${present.length === 1 ? "" : "s"} verified in target environment.`}
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("target")}>
              Back
            </Button>
            <Button
              disabled={isLoading || !canProceed || nameCollision}
              onClick={() => setStep("diff")}
            >
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Step 3: Diff preview
  if (step === "diff") {
    const diff = diffQuery.data;
    const isLoading = diffQuery.isLoading;

    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Substitution Preview</DialogTitle>
            <DialogDescription>
              Review how secret references will be substituted in the target environment.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating substitution preview...
              </div>
            ) : diff ? (
              <>
                <ConfigDiff
                  oldConfig={diff.sourceYaml}
                  newConfig={diff.targetYaml}
                  oldLabel="Source Environment"
                  newLabel="Target Environment"
                />
                <p className="text-xs text-muted-foreground">
                  <code>SECRET[name]</code> references will be resolved as environment
                  variables in the target environment.
                </p>
              </>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStep("preflight")}>
              Back
            </Button>
            <Button
              disabled={isLoading || !diff}
              onClick={handleConfirmPromotion}
            >
              Confirm Promotion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Step 4: Confirm (submitting)
  if (step === "confirm") {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Submitting Promotion</DialogTitle>
            <DialogDescription>
              Your promotion request is being processed.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting promotion request...
          </div>

          <DialogFooter>
            <Button variant="outline" disabled>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // Step 5: Result
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promotion Complete</DialogTitle>
          <DialogDescription>
            Your pipeline has been promoted to {selectedEnv?.name ?? "the target environment"}.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          {result?.pendingApproval ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <p className="font-medium">Promotion request submitted for approval</p>
                  <p className="mt-1">
                    An administrator must approve before the pipeline appears in{" "}
                    {selectedEnv?.name ?? "the target environment"}.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-green-500/30 bg-green-500/10 p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="mt-0.5 h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
                <div className="text-sm text-green-800 dark:text-green-300">
                  <p className="font-medium">Pipeline promoted successfully</p>
                  <p className="mt-1">
                    The pipeline has been deployed to{" "}
                    {selectedEnv?.name ?? "the target environment"}.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={() => handleClose(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
