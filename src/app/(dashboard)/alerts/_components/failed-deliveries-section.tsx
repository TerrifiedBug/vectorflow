"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { RotateCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

interface FailedDeliveriesSectionProps {
  environmentId: string;
}

export function FailedDeliveriesSection({ environmentId }: FailedDeliveriesSectionProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const failedQuery = useQuery(
    trpc.alert.listFailedDeliveries.queryOptions({ environmentId }),
  );

  const retryMutation = useMutation(
    trpc.alert.retryDelivery.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.alert.listFailedDeliveries.queryKey({ environmentId }),
        });
        toast.success("Retry initiated");
      },
      onError: (err) => {
        toast.error("Retry failed", { description: err.message, duration: 6000 });
      },
    }),
  );

  const retryAllMutation = useMutation(
    trpc.alert.retryAllForChannel.mutationOptions({
      onSuccess: (data) => {
        queryClient.invalidateQueries({
          queryKey: trpc.alert.listFailedDeliveries.queryKey({ environmentId }),
        });
        toast.success(`Retried ${data.retriedCount} of ${data.totalFailed} deliveries`);
      },
      onError: (err) => {
        toast.error("Retry all failed", { description: err.message, duration: 6000 });
      },
    }),
  );

  const deliveries = failedQuery.data ?? [];

  if (deliveries.length === 0 && !failedQuery.isLoading) {
    return null; // Don't show the section if there are no failed deliveries
  }

  // Group by channelName + channelType
  const grouped = new Map<string, typeof deliveries>();
  for (const d of deliveries) {
    const key = `${d.channelType}:${d.channelName}`;
    const group = grouped.get(key) ?? [];
    group.push(d);
    grouped.set(key, group);
  }

  const CHANNEL_ICONS: Record<string, string> = {
    slack: "🔔",
    email: "📧",
    webhook: "🌐",
    pagerduty: "🚨",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <h2 className="text-lg font-semibold">Failed Deliveries</h2>
        <StatusBadge variant="error">{deliveries.length} failed</StatusBadge>
      </div>
      <p className="text-sm text-muted-foreground">
        Deliveries that failed across all alert events, grouped by channel.
      </p>

      <div className="space-y-4">
        {[...grouped.entries()].map(([key, items]) => {
          const channelType = key.split(":")[0];
          const channelName = key.split(":").slice(1).join(":");
          return (
            <div key={key} className="rounded-md border">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true">{CHANNEL_ICONS[channelType] ?? "📡"}</span>
                  <span className="font-medium text-sm">{channelName}</span>
                  <span className="text-xs text-muted-foreground">({items.length} failed)</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => retryAllMutation.mutate({
                    channelName,
                    channelType,
                    environmentId,
                  })}
                  disabled={retryAllMutation.isPending}
                >
                  <RotateCw className="h-3 w-3 mr-1" />
                  Retry all
                </Button>
              </div>
              <div className="divide-y divide-border">
                {items.map((delivery) => (
                  <div
                    key={delivery.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm"
                  >
                    <span className="text-sm font-medium min-w-[120px]">
                      {delivery.alertEvent?.alertRule?.name ?? "Unknown rule"}
                    </span>
                    {delivery.attemptNumber != null && delivery.attemptNumber > 1 && (
                      <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                        Attempt #{delivery.attemptNumber}
                      </span>
                    )}
                    {delivery.errorMessage && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs text-destructive truncate max-w-[250px] cursor-default">
                            {delivery.errorMessage.length > 200
                              ? `${delivery.errorMessage.slice(0, 200)}…`
                              : delivery.errorMessage}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-sm break-words">
                          {delivery.errorMessage}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
                      {delivery.requestedAt
                        ? new Date(delivery.requestedAt).toLocaleString()
                        : "—"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => retryMutation.mutate({ deliveryAttemptId: delivery.id })}
                      disabled={retryMutation.isPending}
                    >
                      <RotateCw className="h-3 w-3 mr-1" />
                      Retry
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
