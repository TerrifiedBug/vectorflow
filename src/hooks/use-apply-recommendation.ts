import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";

/**
 * Hook to handle the "Apply" action on a cost recommendation.
 *
 * When invoked:
 * 1. Marks the recommendation as APPLIED
 * 2. Navigates to the pipeline editor with the recommendation ID as a query param
 * 3. The editor reads the recommendation's suggestedAction to pre-populate changes
 */
export function useApplyRecommendation(environmentId: string) {
  const trpc = useTRPC();
  const router = useRouter();
  const queryClient = useQueryClient();

  const markAppliedMutation = useMutation(
    trpc.costRecommendation.markApplied.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.costRecommendation.list.queryKey({ environmentId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.costRecommendation.summary.queryKey({ environmentId }),
        });
      },
      onError: (error) => {
        toast.error(`Failed to apply recommendation: ${error.message}`);
      },
    }),
  );

  const applyRecommendation = useCallback(
    (recommendationId: string, pipelineId: string) => {
      // Navigate to the pipeline editor with recommendation context
      router.push(
        `/pipelines/${pipelineId}/edit?recommendation=${recommendationId}`,
      );

      // Mark as applied in the background
      markAppliedMutation.mutate({
        environmentId,
        id: recommendationId,
      });

      toast.info("Opening pipeline editor with suggested changes...");
    },
    [environmentId, markAppliedMutation, router],
  );

  return { applyRecommendation, isApplying: markAppliedMutation.isPending };
}
