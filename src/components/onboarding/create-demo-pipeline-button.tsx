"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { Button } from "@/components/ui/button";
import { TOUR_DEMO_PIPELINE_ATTR } from "@/components/onboarding/product-tour";

interface CreateDemoPipelineButtonProps {
  /** Environment the demo pipeline is created in. */
  environmentId: string;
  className?: string;
}

/**
 * One-click onboarding action: creates a complete sample pipeline
 * (demo logs → remap → blackhole) via `pipeline.createDemoPipeline` and
 * opens it in the editor on success. Kept self-contained so the
 * presentational OnboardingChecklist stays free of data dependencies.
 */
export function CreateDemoPipelineButton({
  environmentId,
  className,
}: CreateDemoPipelineButtonProps) {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const createDemo = useMutation(
    trpc.pipeline.createDemoPipeline.mutationOptions({
      onError: (error) => {
        toast.error(error.message || "Failed to create demo pipeline", {
          duration: 6000,
        });
      },
    }),
  );

  const handleClick = async () => {
    if (!environmentId) {
      toast.error("Select an environment first", { duration: 6000 });
      return;
    }
    try {
      const pipeline = await createDemo.mutateAsync({ environmentId });
      queryClient.invalidateQueries({ queryKey: trpc.pipeline.list.queryKey() });
      toast.success("Demo pipeline created");
      router.push(`/pipelines/${pipeline.id}/edit`);
    } catch {
      // Failure already surfaced by the mutation's onError handler.
    }
  };

  return (
    <Button
      type="button"
      variant="primary"
      size="md"
      onClick={handleClick}
      disabled={createDemo.isPending || !environmentId}
      className={className}
      data-tour={TOUR_DEMO_PIPELINE_ATTR}
    >
      {createDemo.isPending ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Creating demo…
        </>
      ) : (
        <>
          <Sparkles className="mr-2 h-4 w-4" />
          Create a demo pipeline
        </>
      )}
    </Button>
  );
}
