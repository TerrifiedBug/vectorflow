"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingDown } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ApplyRecommendationModalProps {
  recommendationId: string | null;
  environmentId: string;
  onClose: () => void;
}

export function ApplyRecommendationModal({
  recommendationId,
  environmentId,
  onClose,
}: ApplyRecommendationModalProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const previewQuery = useQuery(
    trpc.costRecommendation.previewApply.queryOptions(
      { environmentId, id: recommendationId! },
      { enabled: !!recommendationId },
    ),
  );

  const applyMutation = useMutation(
    trpc.costRecommendation.applyRecommendation.mutationOptions({
      onSuccess: (data) => {
        toast.success(
          `Applied to ${data.pipelineName}. Version ${data.versionNumber} created — deploy when ready.`,
        );
        queryClient.invalidateQueries({
          queryKey: trpc.costRecommendation.list.queryKey({ environmentId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.costRecommendation.summary.queryKey({ environmentId }),
        });
        onClose();
      },
      onError: (error) => {
        toast.error(`Failed to apply: ${error.message}`);
      },
    }),
  );

  const handleApply = () => {
    if (!recommendationId) return;
    applyMutation.mutate({ environmentId, id: recommendationId });
  };

  const diffLines = useMemo(() => {
    if (!previewQuery.data || "isDisable" in previewQuery.data) return [];
    return previewQuery.data.diff.split("\n").map((line, i) => ({
      key: i,
      text: line,
      type: line.startsWith("+")
        ? ("added" as const)
        : line.startsWith("-")
          ? ("removed" as const)
          : ("context" as const),
    }));
  }, [previewQuery.data]);

  const isDisable = previewQuery.data && "isDisable" in previewQuery.data;
  const recommendation = previewQuery.data?.recommendation;

  return (
    <Dialog
      open={!!recommendationId}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            Apply Recommendation
          </DialogTitle>
          {recommendation && (
            <DialogDescription asChild>
              <div className="flex items-center justify-between pt-1">
                <div>
                  <p className="font-medium text-foreground">
                    {recommendation.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Pipeline:{" "}
                    <span className="text-blue-500">
                      {recommendation.pipelineName}
                    </span>
                  </p>
                </div>
                {recommendation.estimatedSavingsBytes != null &&
                  recommendation.estimatedSavingsBytes > BigInt(0) && (
                    <Badge
                      variant="secondary"
                      className="gap-1 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                    >
                      <TrendingDown className="h-3 w-3" />~
                      {formatBytes(
                        Number(recommendation.estimatedSavingsBytes),
                      )}
                      /day
                    </Badge>
                  )}
              </div>
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-0">
          {previewQuery.isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {previewQuery.isError && (
            <div className="p-4 text-sm text-destructive">
              Failed to load preview: {previewQuery.error.message}
            </div>
          )}

          {isDisable && (
            <div className="p-4 text-sm text-muted-foreground">
              This will set the pipeline to <strong>draft</strong> (disabled)
              state. No configuration changes will be made. The pipeline will
              stop receiving deployments until re-enabled.
            </div>
          )}

          {!previewQuery.isLoading &&
            !previewQuery.isError &&
            !isDisable && (
              <pre className="p-4 text-xs leading-relaxed">
                {diffLines.map((line) => (
                  <div
                    key={line.key}
                    className={cn(
                      "-mx-2 px-2",
                      line.type === "added" &&
                        "bg-green-500/10 text-green-600 dark:text-green-400",
                      line.type === "removed" &&
                        "bg-red-500/10 text-red-600 dark:text-red-400",
                      line.type === "context" && "text-muted-foreground",
                    )}
                  >
                    {line.text}
                  </div>
                ))}
              </pre>
            )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={applyMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={
              previewQuery.isLoading ||
              previewQuery.isError ||
              applyMutation.isPending
            }
          >
            {applyMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Applying...
              </>
            ) : (
              "Apply & Save"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
