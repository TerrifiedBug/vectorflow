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

const dialogContentClass =
  "gap-0 overflow-hidden rounded-[3px] border-line-2 bg-bg-2 p-0 text-fg shadow-[0_24px_60px_rgba(0,0,0,0.6)] sm:max-w-lg";
const wideDialogContentClass =
  "gap-0 overflow-hidden rounded-[3px] border-line-2 bg-bg-2 p-0 text-fg shadow-[0_24px_60px_rgba(0,0,0,0.6)] sm:max-w-2xl";
const dialogHeaderClass = "border-b border-line bg-bg-2 px-5 py-4 pr-12";
const dialogFooterClass = "border-t border-line bg-bg px-5 py-3";
const labelClass = "font-mono text-[10px] uppercase tracking-[0.08em] text-fg-2";

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
    trpc.release.promotion.preflight.queryOptions(
      { pipelineId: pipeline.id, targetEnvironmentId: targetEnvId, name },
      { enabled: step === "preflight" && !!targetEnvId }
    )
  );

  // Step 3: Diff preview
  const diffQuery = useQuery(
    trpc.release.promotion.diffPreview.queryOptions(
      { pipelineId: pipeline.id },
      { enabled: step === "diff" }
    )
  );

  // Step 4: Initiate mutation
  const initiateMutation = useMutation(
    trpc.release.promotion.initiate.mutationOptions({
      onSuccess: (data) => {
        setResult(data);
        setStep("result");
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.list.queryKey(),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.release.promotion.history.queryKey({ pipelineId: pipeline.id }),
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

  const stepMeta = [
    { key: "target", label: "Target" },
    { key: "preflight", label: "Preflight" },
    { key: "diff", label: "Diff preview" },
    { key: "result", label: "Result" },
  ] as const;
  const activeStepIndex = step === "confirm" ? 2 : stepMeta.findIndex((s) => s.key === step);

  const stepper = (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-bg-1 px-5 py-3">
      {stepMeta.map((s, index) => {
        const isActive = index === activeStepIndex;
        const isDone = index < activeStepIndex;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <span className={[
              "flex h-[22px] w-[22px] items-center justify-center rounded-full border font-mono text-[11px]",
              isActive ? "border-accent-brand bg-accent-brand text-primary-foreground" : isDone ? "border-[color:var(--status-healthy)]/50 bg-bg text-status-healthy" : "border-line bg-bg-2 text-fg-2",
            ].join(" ")}>
              {isDone ? "✓" : index + 1}
            </span>
            <span className={[
              "font-mono text-[11px] uppercase tracking-[0.04em]",
              isActive ? "text-fg" : isDone ? "text-fg-1" : "text-fg-2",
            ].join(" ")}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );

  // Step 1: Target selection
  if (step === "target") {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className={dialogContentClass}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle className="font-mono text-[15px]">Promote pipeline</DialogTitle>
            <DialogDescription className="text-[12px] text-fg-2">
              Copy <span className="font-mono text-fg">{pipeline.name}</span> to another environment with preflight validation.
            </DialogDescription>
          </DialogHeader>
          {stepper}

          <div className="space-y-4 px-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="promote-target-env" className={labelClass}>Target environment</Label>
              <Select value={targetEnvId} onValueChange={setTargetEnvId}>
                <SelectTrigger id="promote-target-env" className="h-8 w-full rounded-[3px] border-line-2 bg-bg font-mono text-[12px]">
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
              <Label htmlFor="promote-pipeline-name" className={labelClass}>Pipeline name</Label>
              <Input
                id="promote-pipeline-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 rounded-[3px] border-line-2 bg-bg font-mono text-[12px]"
              />
            </div>
          </div>

          <DialogFooter className={dialogFooterClass}>
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
        <DialogContent className={dialogContentClass}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle className="font-mono text-[15px]">Preflight check</DialogTitle>
            <DialogDescription className="text-[12px] text-fg-2">
              Validate secret references in <span className="font-mono text-fg">{selectedEnv?.name ?? "target"}</span>.
            </DialogDescription>
          </DialogHeader>
          {stepper}

          <div className="space-y-3 px-5 py-4">
            {isLoading ? (
              <div className="flex items-center gap-2 font-mono text-[12px] text-fg-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking secret references...
              </div>
            ) : (
              <>
                {missing.length > 0 && (
                  <div className="rounded-[3px] border border-destructive/30 bg-destructive/10 p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive shrink-0" />
                      <div className="text-[12px] text-destructive">
                        <p className="mb-1 font-medium">
                          The following secrets are missing in the target environment and must be
                          created before promotion can proceed:
                        </p>
                        <ul className="space-y-0.5 pl-0 font-mono">
                          {missing.map((s) => (
                            <li key={s}>
                              <code className="text-[11px]">{s}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {nameCollision && (
                  <div className="rounded-[3px] border border-[color:var(--status-degraded)]/30 bg-[color:var(--status-degraded-bg)] p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-degraded" />
                      <p className="text-[12px] text-status-degraded">
                        A pipeline named &quot;{name}&quot; already exists in the target environment.
                        Go back and change the pipeline name to proceed.
                      </p>
                    </div>
                  </div>
                )}

                {canProceed && !nameCollision && (
                  <div className="rounded-[3px] border border-[color:var(--status-healthy)]/30 bg-[color:var(--status-healthy-bg)] p-3">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 shrink-0 text-status-healthy" />
                      <p className="text-[12px] text-status-healthy">
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

          <DialogFooter className={dialogFooterClass}>
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
        <DialogContent className={wideDialogContentClass}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle className="font-mono text-[15px]">Substitution preview</DialogTitle>
            <DialogDescription className="text-[12px] text-fg-2">
              Review secret substitution before promoting to <span className="font-mono text-fg">{selectedEnv?.name ?? "target"}</span>.
            </DialogDescription>
          </DialogHeader>
          {stepper}

          <div className="space-y-3 px-5 py-4">
            {isLoading ? (
              <div className="flex items-center gap-2 font-mono text-[12px] text-fg-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating substitution preview...
              </div>
            ) : diff ? (
              <>
                <ConfigDiff
                  oldConfig={diff.sourceYaml}
                  newConfig={diff.targetYaml}
                  oldLabel="Source"
                  newLabel="Target"
                />
                <p className="font-mono text-[11px] text-fg-2">
                  <code className="rounded-[3px] bg-bg px-1 text-fg">SECRET[name]</code> references resolve as environment
                  variables in the target environment.
                </p>
              </>
            ) : null}
          </div>

          <DialogFooter className={dialogFooterClass}>
            <Button variant="outline" onClick={() => setStep("preflight")}>
              Back
            </Button>
            <Button
              disabled={isLoading || !diff}
              onClick={handleConfirmPromotion}
            >
              Confirm promotion
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
        <DialogContent className={dialogContentClass}>
          <DialogHeader className={dialogHeaderClass}>
            <DialogTitle className="font-mono text-[15px]">Submitting promotion</DialogTitle>
            <DialogDescription className="text-[12px] text-fg-2">
              Creating promotion request for <span className="font-mono text-fg">{pipeline.name}</span>.
            </DialogDescription>
          </DialogHeader>
          {stepper}

          <div className="flex items-center gap-2 px-5 py-6 font-mono text-[12px] text-fg-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Submitting promotion request...
          </div>

          <DialogFooter className={dialogFooterClass}>
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
      <DialogContent className={dialogContentClass}>
        <DialogHeader className={dialogHeaderClass}>
          <DialogTitle className="font-mono text-[15px]">Promotion result</DialogTitle>
          <DialogDescription className="text-[12px] text-fg-2">
            Target environment: <span className="font-mono text-fg">{selectedEnv?.name ?? "target"}</span>
          </DialogDescription>
        </DialogHeader>
        {stepper}

        <div className="px-5 py-4">
          {result?.pendingApproval ? (
            <div className="rounded-[3px] border border-[color:var(--status-degraded)]/30 bg-[color:var(--status-degraded-bg)] p-4">
              <div className="flex items-start gap-3">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-status-degraded" />
                <div className="text-[12px] text-status-degraded">
                  <p className="font-medium">Promotion request submitted for approval</p>
                  <p className="mt-1">
                    An administrator must approve before the pipeline appears in{" "}
                    {selectedEnv?.name ?? "the target environment"}.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[3px] border border-[color:var(--status-healthy)]/30 bg-[color:var(--status-healthy-bg)] p-4">
              <div className="flex items-start gap-3">
                <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-status-healthy" />
                <div className="text-[12px] text-status-healthy">
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

        <DialogFooter className={dialogFooterClass}>
          <Button onClick={() => handleClose(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
