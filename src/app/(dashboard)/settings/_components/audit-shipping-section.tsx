"use client";

import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { QueryError } from "@/components/query-error";

// ─── Audit Log Shipping Section ─────────────────────────────────────────────

export function AuditLogShippingSection() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const systemPipelineQuery = useQuery(
    trpc.pipeline.getSystemPipeline.queryOptions(),
  );

  const createSystemPipelineMutation = useMutation(
    trpc.pipeline.createSystemPipeline.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.getSystemPipeline.queryKey(),
        });
        toast.success("Audit log shipping pipeline created");
      },
      onError: (error) => {
        if (error.message?.includes("already exists")) {
          queryClient.invalidateQueries({
            queryKey: trpc.pipeline.getSystemPipeline.queryKey(),
          });
        } else {
          toast.error(error.message || "Failed to create system pipeline");
        }
      },
    }),
  );

  const undeployMutation = useMutation(
    trpc.deploy.undeploy.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.getSystemPipeline.queryKey(),
        });
        toast.success("Audit log shipping disabled");
      },
      onError: (error) => {
        toast.error(error.message || "Failed to disable audit log shipping");
      },
    }),
  );

  const deployMutation = useMutation(
    trpc.deploy.agent.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.pipeline.getSystemPipeline.queryKey(),
        });
        toast.success("Audit log shipping enabled");
      },
      onError: (error: { message?: string }) => {
        toast.error(error.message || "Failed to enable audit log shipping");
      },
    }),
  );

  const systemPipeline = systemPipelineQuery.data;
  const isLoading = systemPipelineQuery.isLoading;
  const isDeployed = systemPipeline && !systemPipeline.isDraft && systemPipeline.deployedAt;
  const isToggling = undeployMutation.isPending || deployMutation.isPending;

  if (systemPipelineQuery.isError) return <QueryError message="Failed to load audit shipping settings" onRetry={() => systemPipelineQuery.refetch()} />;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Audit Log Shipping</CardTitle>
            <CardDescription>
              Ship audit logs to external destinations via Vector. Configure
              transforms and sinks in the pipeline editor.
            </CardDescription>
          </div>
          {!isLoading && systemPipeline && (
            <Badge
              variant="outline"
              className={
                isDeployed
                  ? "text-xs text-green-600 border-green-600"
                  : "text-xs text-yellow-600 border-yellow-600"
              }
            >
              {isDeployed ? (
                <>
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Active
                </>
              ) : (
                <>
                  <XCircle className="mr-1 h-3 w-3" />
                  Disabled
                </>
              )}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-9 w-48" />
        ) : systemPipeline ? (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Audit log shipping is {isDeployed ? "active" : "configured but disabled"}.
            </span>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/pipelines/${systemPipeline.id}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Configure sinks
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <Switch
                checked={!!isDeployed}
                onCheckedChange={(checked) => {
                  if (checked) {
                    deployMutation.mutate({ pipelineId: systemPipeline.id, changelog: "Enabled system pipeline from settings" });
                  } else {
                    undeployMutation.mutate({ pipelineId: systemPipeline.id });
                  }
                }}
                disabled={isToggling}
              />
              <span className="text-sm text-muted-foreground">
                {isToggling ? (isDeployed ? "Disabling..." : "Enabling...") : (isDeployed ? "Active" : "Disabled")}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Audit log shipping is not configured.
            </span>
            <Button
              size="sm"
              onClick={() => createSystemPipelineMutation.mutate()}
              disabled={createSystemPipelineMutation.isPending}
            >
              {createSystemPipelineMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Enable Audit Log Shipping"
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
