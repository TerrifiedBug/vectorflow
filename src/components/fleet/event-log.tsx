"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTime } from "@/lib/format";
import { statusColor } from "@/lib/status";

type Range = "1h" | "6h" | "1d" | "7d" | "30d";

interface EventLogProps {
  nodeId: string;
  range: Range;
}

export function EventLog({ nodeId, range }: EventLogProps) {
  const trpc = useTRPC();

  const { data: events, isLoading } = useQuery({
    ...trpc.fleet.getStatusTimeline.queryOptions({ nodeId, range }),
    refetchInterval: 15_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-full rounded" />
        <Skeleton className="h-8 w-full rounded" />
        <Skeleton className="h-8 w-full rounded" />
      </div>
    );
  }

  const reversed = events ? [...events].reverse() : [];

  if (reversed.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No events in this time range.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {reversed.map((event) => (
        <div key={event.id} className="flex items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
          {/* Colored dot for toStatus */}
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: statusColor(event.toStatus) }}
          />
          {/* Timestamp */}
          <span className="w-12 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {formatTime(event.timestamp)}
          </span>
          {/* Transition */}
          <span className="font-medium">
            {event.fromStatus === null
              ? "enrolled"
              : `${event.fromStatus} → ${event.toStatus}`}
          </span>
          {/* Reason */}
          {event.reason && (
            <span className="truncate text-muted-foreground">{event.reason}</span>
          )}
        </div>
      ))}
    </div>
  );
}
