"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Rocket, CheckCircle, XCircle, Loader2, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

interface DeployDialogProps {
  pipelineId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeployDialog({ pipelineId, open, onOpenChange }: DeployDialogProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [deploying, setDeploying] = useState(false);

  const previewQuery = useQuery({
    ...trpc.deploy.preview.queryOptions({ pipelineId }),
    enabled: open,
  });

  const envQuery = useQuery({
    ...trpc.deploy.environmentInfo.queryOptions({ pipelineId }),
    enabled: open,
  });

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
    agentMutation.mutate({ pipelineId });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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
                <span className="text-xs font-medium text-muted-foreground">Generated Config</span>
                <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-all">
                  {preview.configYaml}
                </pre>
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
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleDeploy}
            disabled={isLoading || !isValid || deploying}
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
