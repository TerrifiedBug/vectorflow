"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Rocket, CheckCircle, XCircle, Loader2, Server, GitBranch } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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

  const apiReloadMutation = useMutation(
    trpc.deploy.apiReload.mutationOptions({
      onSuccess: (result) => {
        setDeploying(false);
        queryClient.invalidateQueries();

        if (!result.success) {
          const failedNodes = result.nodeResults?.filter((n) => !n.success) ?? [];
          const errorMsg = result.validationErrors?.map((e) => e.message).join("; ")
            || failedNodes.map((n) => `${n.nodeName}: ${n.error}`).join("; ")
            || "Unknown error";
          toast.error("Deploy failed", { description: errorMsg });
          return;
        }

        const healthyNodes = result.nodeResults?.filter((n) => n.healthAfter).length ?? 0;
        const totalNodes = result.nodeResults?.length ?? 0;
        const version = result.versionNumber ? `v${result.versionNumber}` : "";

        if (result.configWritten) {
          toast.success(`Config deployed ${version}`, {
            description: `Written to ${result.configPath}. ${healthyNodes}/${totalNodes} node(s) healthy.`,
          });
        } else {
          toast.success(`Version ${version} created`, {
            description: `${healthyNodes}/${totalNodes} node(s) healthy. Set VECTOR_CONFIG_DIR to enable config file push.`,
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

  const gitopsMutation = useMutation(
    trpc.deploy.gitops.mutationOptions({
      onSuccess: (result) => {
        setDeploying(false);
        queryClient.invalidateQueries();

        if (!result.success) {
          const errorMsg = result.validationErrors?.map((e) => e.message).join("; ")
            || result.error
            || "Unknown error";
          toast.error("GitOps deploy failed", { description: errorMsg });
          return;
        }

        toast.success("Config committed via GitOps", {
          description: result.commitHash
            ? `Commit ${result.commitHash.slice(0, 8)} (v${result.versionNumber ?? "?"})`
            : undefined,
        });
        onOpenChange(false);
      },
      onError: (err) => {
        setDeploying(false);
        toast.error("GitOps deploy failed", { description: err.message });
      },
    })
  );

  const env = envQuery.data;
  const preview = previewQuery.data;
  const isLoading = previewQuery.isLoading || envQuery.isLoading;
  const isValid = preview?.validation?.valid ?? false;

  function handleDeploy() {
    if (!env) return;
    setDeploying(true);

    if (env.deployMode === "GITOPS" && env.gitRepo && env.gitBranch) {
      gitopsMutation.mutate({
        pipelineId,
        environmentId: env.environmentId,
        repoUrl: env.gitRepo,
        branch: env.gitBranch,
      });
    } else {
      apiReloadMutation.mutate({
        pipelineId,
        environmentId: env.environmentId,
      });
    }
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
            {/* Environment info */}
            {env && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{env.environmentName}</span>
                  <Badge variant="secondary" className="text-xs">
                    {env.deployMode === "GITOPS" ? (
                      <><GitBranch className="mr-1 h-3 w-3" />GitOps</>
                    ) : (
                      <><Server className="mr-1 h-3 w-3" />API Reload</>
                    )}
                  </Badge>
                </div>
                {env.deployMode === "API_RELOAD" && (
                  env.nodes.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {env.nodes.length} node(s): {env.nodes.map((n) => n.name).join(", ")}
                    </p>
                  ) : (
                    <div className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                      No fleet nodes registered in this environment. Go to Fleet to add Vector nodes, or switch to GitOps deploy mode.
                    </div>
                  )
                )}
                {env.deployMode === "GITOPS" && env.gitRepo && (
                  <p className="text-xs text-muted-foreground truncate">
                    {env.gitRepo} ({env.gitBranch ?? "main"})
                  </p>
                )}
              </div>
            )}

            <Separator />

            {/* Validation status */}
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

            {/* Config preview */}
            {preview?.configYaml && (
              <div className="space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Generated Config</span>
                <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {preview.configYaml}
                </pre>
              </div>
            )}

            {/* Version info */}
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
            disabled={isLoading || !isValid || deploying || !env || (env?.deployMode === "API_RELOAD" && env?.nodes.length === 0)}
          >
            {deploying ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deploying...</>
            ) : (
              <><Rocket className="mr-2 h-4 w-4" />Deploy</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
