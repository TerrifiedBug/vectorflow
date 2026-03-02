"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Radio,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DiffViewer } from "@/components/deploy/diff-viewer";

export default function DeployPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const trpc = useTRPC();
  const pipelineId = params.id;

  const [deployResult, setDeployResult] = useState<{
    success: boolean;
    versionId?: string;
    versionNumber?: number;
    error?: string;
  } | null>(null);

  // Fetch pipeline info
  const pipelineQuery = useQuery(
    trpc.pipeline.get.queryOptions({ id: pipelineId }),
  );

  // Fetch deploy preview (generated config + validation + diff)
  const previewQuery = useQuery(
    trpc.deploy.preview.queryOptions({ pipelineId }),
  );

  // Fetch environment info
  const envQuery = useQuery(
    trpc.deploy.environmentInfo.queryOptions({ pipelineId }),
  );

  // Agent deploy mutation
  const agentMutation = useMutation(
    trpc.deploy.agent.mutationOptions({
      onSuccess: (data) => {
        setDeployResult({
          success: data.success,
          versionId: data.versionId,
          versionNumber: data.versionNumber,
          error: data.error,
        });
        if (data.success) {
          toast.success(
            `Published version ${data.versionNumber} to agents`,
          );
        } else {
          toast.error(data.error || "Deployment failed");
        }
      },
      onError: (err: { message: string }) => {
        toast.error(err.message || "Deployment failed");
      },
    }),
  );

  const isDeploying = agentMutation.isPending;
  const isLoading =
    pipelineQuery.isLoading || previewQuery.isLoading || envQuery.isLoading;

  const handleDeploy = () => {
    if (!envQuery.data) return;
    setDeployResult(null);
    agentMutation.mutate({ pipelineId });
  };

  if (isLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const validation = previewQuery.data?.validation;
  const isValid = validation?.valid ?? false;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push(`/pipelines/${pipelineId}`)}
          aria-label="Back to pipeline"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">
            Deploy {pipelineQuery.data?.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Review and deploy your pipeline configuration
          </p>
        </div>
      </div>

      {/* Validation Result */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Validation</CardTitle>
            {isValid ? (
              <Badge className="bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Passed
              </Badge>
            ) : (
              <Badge variant="destructive">
                <XCircle className="mr-1 h-3 w-3" />
                Failed
              </Badge>
            )}
          </div>
        </CardHeader>
        {!isValid && validation && (
          <CardContent>
            <div className="space-y-1">
              {validation.errors.map((err, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400"
                >
                  <XCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>
                    {err.componentKey && (
                      <code className="mr-1 rounded bg-muted px-1 text-xs">
                        {err.componentKey}
                      </code>
                    )}
                    {err.message}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        )}
        {validation?.warnings && validation.warnings.length > 0 && (
          <CardContent className={isValid ? "" : "pt-0"}>
            <div className="space-y-1">
              {validation.warnings.map((warn, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 text-sm text-yellow-600 dark:text-yellow-400"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{warn.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Config Diff */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration Changes</CardTitle>
          <CardDescription>
            {previewQuery.data?.currentVersion
              ? `Comparing against version ${previewQuery.data.currentVersion}`
              : "First deployment — no previous version to compare"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {previewQuery.data && (
            <DiffViewer
              oldYaml={previewQuery.data.currentConfigYaml}
              newYaml={previewQuery.data.configYaml}
            />
          )}
        </CardContent>
      </Card>

      {/* Environment Info */}
      {envQuery.data && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Environment</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium">Name</p>
                <p className="text-sm text-muted-foreground">
                  {envQuery.data.environmentName}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">Enrolled Nodes</p>
                <p className="text-sm text-muted-foreground">
                  {envQuery.data.nodes.length} node{envQuery.data.nodes.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deploy Action */}
      <Separator />

      <div className="flex items-center justify-between">
        <div>
          {deployResult?.success && (
            <p className="text-sm text-green-600 dark:text-green-400">
              <CheckCircle2 className="mr-1 inline h-4 w-4" />
              Published as version {deployResult.versionNumber}
            </p>
          )}
          {deployResult && !deployResult.success && deployResult.error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              <XCircle className="mr-1 inline h-4 w-4" />
              {deployResult.error}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/pipelines/${pipelineId}`)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDeploy}
            disabled={!isValid || isDeploying || deployResult?.success === true}
          >
            {isDeploying ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <Radio className="mr-2 h-4 w-4" />
                Publish to Agents
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Success summary with links */}
      {deployResult?.success && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Deployment Complete</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  router.push(`/pipelines/${pipelineId}/versions`)
                }
              >
                View Version History
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`/pipelines/${pipelineId}`)}
              >
                Back to Pipeline
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
