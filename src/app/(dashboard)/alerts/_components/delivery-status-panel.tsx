"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import { RotateCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

// ─── Channel Type Icons ─────────────────────────────────────────────────────

const CHANNEL_ICONS: Record<string, string> = {
  slack: "🔔",
  email: "📧",
  webhook: "🌐",
  pagerduty: "🚨",
};

function channelIcon(type: string): string {
  return CHANNEL_ICONS[type] ?? "📡";
}

// ─── Status → StatusBadge variant mapping ────────────────────────────────────

function statusVariant(status: string) {
  switch (status) {
    case "success":
      return "healthy" as const;
    case "failed":
      return "error" as const;
    case "pending":
      return "degraded" as const;
    default:
      return "neutral" as const;
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "success":
      return "Success";
    case "failed":
      return "Failed";
    case "pending":
      return "Pending";
    default:
      return status;
  }
}

// ─── Delivery Status Panel ───────────────────────────────────────────────────

interface DeliveryStatusPanelProps {
  alertEventId: string;
  isOpen: boolean;
}

export function DeliveryStatusPanel({ alertEventId, isOpen }: DeliveryStatusPanelProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const retryMutation = useMutation(
    trpc.alert.retryDelivery.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.alert.listDeliveries.queryKey({ alertEventId }),
        });
        toast.success("Retry initiated");
      },
      onError: (err) => {
        toast.error("Retry failed", { description: err.message, duration: 6000 });
      },
    }),
  );

  const deliveriesQuery = useQuery(
    trpc.alert.listDeliveries.queryOptions(
      { alertEventId },
      { enabled: isOpen },
    ),
  );

  if (!isOpen) return null;

  if (deliveriesQuery.isLoading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (deliveriesQuery.isError) {
    return (
      <div className="p-3 text-sm text-destructive">
        Failed to load delivery attempts.
      </div>
    );
  }

  const deliveries = deliveriesQuery.data ?? [];

  if (deliveries.length === 0) {
    return (
      <div className="p-3 text-sm text-muted-foreground">
        No delivery attempts recorded
      </div>
    );
  }

  const formatTimestamp = (date: Date | string | null) => {
    if (!date) return null;
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleString();
  };

  return (
    <div className="space-y-1 p-3">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Delivery Attempts
      </p>
      <div className="divide-y divide-border rounded-md border">
        {deliveries.map((delivery) => (
          <div
            key={delivery.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm"
          >
            {/* Channel type + name */}
            <span className="flex items-center gap-1.5 min-w-[140px]">
              <span aria-hidden="true">{channelIcon(delivery.channelType)}</span>
              <span className="font-medium truncate max-w-[200px]">
                {delivery.channelName}
              </span>
            </span>

            {/* Retry label — shown only for retry attempts (attemptNumber > 1) */}
            {delivery.attemptNumber != null && delivery.attemptNumber > 1 && (
              <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                Retry #{delivery.attemptNumber - 1}
              </span>
            )}

            {/* Status badge */}
            <StatusBadge variant={statusVariant(delivery.status)}>
              {statusLabel(delivery.status)}
            </StatusBadge>

            {/* HTTP status code */}
            {delivery.statusCode != null && (
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                HTTP {delivery.statusCode}
              </span>
            )}

            {/* Error message (truncated with tooltip) */}
            {delivery.errorMessage && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-destructive truncate max-w-[200px] cursor-default">
                    {delivery.errorMessage.length > 200
                      ? `${delivery.errorMessage.slice(0, 200)}…`
                      : delivery.errorMessage}
                  </span>
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="max-w-sm break-words"
                >
                  {delivery.errorMessage}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Timestamps */}
            <span className="ml-auto text-xs text-muted-foreground whitespace-nowrap">
              {formatTimestamp(delivery.requestedAt)}
              {delivery.completedAt
                ? ` → ${formatTimestamp(delivery.completedAt)}`
                : " → Pending…"}
            </span>

            {/* Retry button for failed deliveries */}
            {delivery.status === "failed" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs ml-2"
                onClick={() => retryMutation.mutate({ deliveryAttemptId: delivery.id })}
                disabled={retryMutation.isPending}
              >
                <RotateCw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
