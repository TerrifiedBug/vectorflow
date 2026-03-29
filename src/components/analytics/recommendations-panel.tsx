"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useRouter } from "next/navigation";
import { RecommendationCard } from "@/components/analytics/recommendation-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Lightbulb } from "lucide-react";
import { formatBytes } from "@/lib/format";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import { EmptyState } from "@/components/empty-state";

interface RecommendationsPanelProps {
  environmentId: string;
}

export function RecommendationsPanel({ environmentId }: RecommendationsPanelProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const pollingInterval = usePollingInterval();

  const summaryQuery = useQuery(
    trpc.costRecommendation.summary.queryOptions(
      { environmentId },
      { refetchInterval: pollingInterval },
    ),
  );

  const listQuery = useQuery(
    trpc.costRecommendation.list.queryOptions(
      { environmentId, limit: 10 },
      { refetchInterval: pollingInterval },
    ),
  );

  const handleApply = (recommendationId: string, pipelineId: string) => {
    // Navigate to pipeline editor with recommendation context
    router.push(
      `/pipelines/${pipelineId}/edit?recommendation=${recommendationId}`,
    );
  };

  if (summaryQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-48" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  const pendingCount = summaryQuery.data?.pendingCount ?? 0;
  const estimatedSavings = summaryQuery.data?.estimatedSavingsBytes ?? BigInt(0);

  if (pendingCount === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Cost Recommendations</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={Lightbulb}
            title="No recommendations"
            description="Your pipelines are looking efficient. Recommendations appear here when optimization opportunities are detected."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <CardTitle className="text-base">Cost Recommendations</CardTitle>
            <Badge variant="secondary" className="text-xs">
              {pendingCount}
            </Badge>
          </div>
          {estimatedSavings > BigInt(0) && (
            <span className="text-sm text-green-600 dark:text-green-400">
              Est. savings: {formatBytes(Number(estimatedSavings))}/day
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {listQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="space-y-3">
            {(listQuery.data ?? []).map((rec) => (
              <RecommendationCard
                key={rec.id}
                recommendation={rec}
                environmentId={environmentId}
                onApply={handleApply}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
