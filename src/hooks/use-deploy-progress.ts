// src/hooks/use-deploy-progress.ts
"use client";

import { useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTRPC } from "@/trpc/client";
import { useDeployProgressStore } from "@/stores/deploy-progress-store";
import { DeployProgressPanel } from "@/components/deploy-progress";
import { createElement } from "react";

interface PipelineInfo {
  id: string;
  name: string;
}

export function useDeployProgress() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { startDeploy, finishDeploy, setToastId, dismiss } = useDeployProgressStore();

  const bulkDeployMutation = useMutation(
    trpc.pipeline.bulkDeploy.mutationOptions({
      onSuccess: (data) => {
        // Build a name map from the stored results in the progress store
        const store = useDeployProgressStore.getState();
        const nameMap = new Map(
          store.results.map((r) => [r.pipelineId, r.pipelineName]),
        );

        finishDeploy(data.results, nameMap);

        // Invalidate pipeline queries
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.list.queryKey() });
        queryClient.invalidateQueries({ queryKey: trpc.pipeline.batchHealth.queryKey() });
      },
      onError: (err) => {
        dismiss();
        toast.error(err.message || "Bulk deploy failed", { duration: 6000 });
      },
    }),
  );

  const startBatchDeploy = useCallback(
    (pipelines: PipelineInfo[], changelog: string) => {
      // Initialize progress state
      startDeploy(pipelines);

      // Show persistent toast with progress panel
      const id = toast.custom(() => createElement(DeployProgressPanel), {
        duration: Infinity,
        dismissible: false,
      });
      setToastId(id);

      // Fire the mutation
      bulkDeployMutation.mutate({
        pipelineIds: pipelines.map((p) => p.id),
        changelog,
      });
    },
    [bulkDeployMutation, startDeploy, setToastId],
  );

  return {
    startBatchDeploy,
    isPending: bulkDeployMutation.isPending,
  };
}
