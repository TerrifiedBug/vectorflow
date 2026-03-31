"use client";

import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  AlertTriangle,
  Copy,
  Clock,
  X,
  ExternalLink,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type RecommendationType = "LOW_REDUCTION" | "HIGH_ERROR_RATE" | "DUPLICATE_SINK" | "STALE_PIPELINE";

interface RecommendationCardProps {
  recommendation: {
    id: string;
    type: RecommendationType;
    title: string;
    description: string;
    aiSummary: string | null;
    estimatedSavingsBytes: bigint | null;
    suggestedAction: unknown;
    aiSuggestions: unknown[] | null;
    createdAt: Date;
    pipeline: { id: string; name: string };
  };
  environmentId: string;
  onApply: (recommendationId: string, pipelineId: string) => void;
}

const TYPE_CONFIG: Record<
  RecommendationType,
  { icon: typeof Lightbulb; label: string; color: string }
> = {
  LOW_REDUCTION: {
    icon: TrendingDown,
    label: "Low Reduction",
    color: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  },
  HIGH_ERROR_RATE: {
    icon: AlertTriangle,
    label: "High Error Rate",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  },
  DUPLICATE_SINK: {
    icon: Copy,
    label: "Duplicate Sink",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
  STALE_PIPELINE: {
    icon: Clock,
    label: "Stale Pipeline",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
  },
};

export function RecommendationCard({
  recommendation,
  environmentId,
  onApply,
}: RecommendationCardProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [isDismissing, setIsDismissing] = useState(false);

  const dismissMutation = useMutation(
    trpc.costRecommendation.dismiss.mutationOptions({
      onSuccess: () => {
        toast.success("Recommendation dismissed");
        queryClient.invalidateQueries({
          queryKey: trpc.costRecommendation.list.queryKey({ environmentId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.costRecommendation.summary.queryKey({ environmentId }),
        });
      },
      onError: (error) => {
        toast.error(`Failed to dismiss: ${error.message}`);
        setIsDismissing(false);
      },
    }),
  );

  const typeConfig = TYPE_CONFIG[recommendation.type];
  const Icon = typeConfig.icon;

  const handleDismiss = () => {
    setIsDismissing(true);
    dismissMutation.mutate({ environmentId, id: recommendation.id });
  };

  const handleApply = () => {
    onApply(recommendation.id, recommendation.pipeline.id);
  };

  return (
    <Card className={cn("transition-opacity", isDismissing && "opacity-50")}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <CardTitle className="text-sm font-medium leading-tight">
              {recommendation.title}
            </CardTitle>
          </div>
          <Badge variant="secondary" className={cn("shrink-0 text-xs", typeConfig.color)}>
            {typeConfig.label}
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Pipeline: {recommendation.pipeline.name}
        </CardDescription>
      </CardHeader>

      <CardContent className="pb-3">
        {recommendation.aiSummary ? (
          <div className="flex gap-2 rounded-md bg-muted/50 p-3">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
            <p className="text-sm text-muted-foreground">{recommendation.aiSummary}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{recommendation.description}</p>
        )}

        {recommendation.estimatedSavingsBytes !== null &&
          recommendation.estimatedSavingsBytes > BigInt(0) && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <TrendingDown className="h-3 w-3" />
              <span>
                Est. savings: {formatBytes(Number(recommendation.estimatedSavingsBytes))}/day
              </span>
            </div>
          )}

        {Array.isArray(recommendation.aiSuggestions) && recommendation.aiSuggestions.length > 0 && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400">
            <Sparkles className="h-3 w-3" />
            <span>
              {recommendation.aiSuggestions.length} suggested change{recommendation.aiSuggestions.length > 1 ? "s" : ""} ready to apply
            </span>
          </div>
        )}
      </CardContent>

      <CardFooter className="gap-2 pt-0">
        <Button
          variant="default"
          size="sm"
          onClick={handleApply}
          className="gap-1.5"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Apply
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDismiss}
          disabled={isDismissing}
          className="gap-1.5 text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Dismiss
        </Button>
      </CardFooter>
    </Card>
  );
}
