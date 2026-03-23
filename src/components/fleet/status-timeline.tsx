"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatTime } from "@/lib/format";
import { statusColor } from "@/lib/status";

type Range = "1h" | "6h" | "1d" | "7d" | "30d";

interface StatusTimelineProps {
  nodeId: string;
  range: Range;
  onRangeChange: (range: Range) => void;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h ${rem}min` : `${hours}h`;
}

export function StatusTimeline({ nodeId, range, onRangeChange }: StatusTimelineProps) {
  const trpc = useTRPC();

  const { data: events, isLoading, dataUpdatedAt } = useQuery({
    ...trpc.fleet.getStatusTimeline.queryOptions({ nodeId, range }),
    refetchInterval: 15_000,
  });

  type Segment = {
    status: string;
    start: number;
    end: number;
  };

  const { segments, totalMs } = useMemo(() => {
    const rangeMs: Record<Range, number> = {
      "1h": 60 * 60 * 1000,
      "6h": 6 * 60 * 60 * 1000,
      "1d": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
    };
    // Use dataUpdatedAt as "now" — it's a stable value from React Query
    // that updates each time data is fetched, keeping segments aligned with data
    const now = dataUpdatedAt || 0;
    const rangeStart = now - rangeMs[range];
    const segs: Segment[] = [];

    if (events !== undefined && now > 0) {
      if (events.length === 0) {
        segs.push({ status: "UNKNOWN", start: rangeStart, end: now });
      } else {
        // First segment: from range start to first event
        const firstStatus = events[0].fromStatus ?? "UNKNOWN";
        segs.push({ status: firstStatus, start: rangeStart, end: new Date(events[0].timestamp).getTime() });

        // Middle segments
        for (let i = 0; i < events.length; i++) {
          const segStart = new Date(events[i].timestamp).getTime();
          const segEnd = i + 1 < events.length ? new Date(events[i + 1].timestamp).getTime() : now;
          segs.push({ status: events[i].toStatus, start: segStart, end: segEnd });
        }
      }
    }

    return { segments: segs, totalMs: now - rangeStart };
  }, [events, range, dataUpdatedAt]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Status Timeline</span>
        <Select value={range} onValueChange={(v) => onRangeChange(v as Range)}>
          <SelectTrigger className="w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1h">1 hour</SelectItem>
            <SelectItem value="6h">6 hours</SelectItem>
            <SelectItem value="1d">1 day</SelectItem>
            <SelectItem value="7d">7 days</SelectItem>
            <SelectItem value="30d">30 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <Skeleton className="h-8 w-full rounded" />
      ) : (
        <TooltipProvider>
          <div className="flex h-8 w-full overflow-hidden rounded">
            {segments.map((seg, i) => {
              const duration = seg.end - seg.start;
              const flexGrow = duration / totalMs;
              const label = `${seg.status} for ${formatDuration(duration)} (${formatTime(new Date(seg.start))} – ${formatTime(new Date(seg.end))})`;
              return (
                <Tooltip key={i}>
                  <TooltipTrigger asChild>
                    <div
                      style={{
                        flexGrow,
                        backgroundColor: statusColor(seg.status),
                        minWidth: 2,
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>{label}</span>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      )}
    </div>
  );
}
