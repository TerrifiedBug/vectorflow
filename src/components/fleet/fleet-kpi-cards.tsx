"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes, formatCount, formatPercent } from "@/lib/format";
import { ArrowDownToLine, ArrowUpFromLine, Activity, Gauge } from "lucide-react";

interface FleetKpiCardsProps {
  data:
    | {
        bytesIn: number;
        bytesOut: number;
        eventsIn: number;
        eventsOut: number;
        errorRate: number;
        nodeCount: number;
      }
    | undefined;
  isLoading: boolean;
}

export function FleetKpiCards({ data, isLoading }: FleetKpiCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ArrowDownToLine className="h-4 w-4" />
            Total Bytes In
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {formatBytes(data?.bytesIn ?? 0)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <ArrowUpFromLine className="h-4 w-4" />
            Total Bytes Out
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {formatBytes(data?.bytesOut ?? 0)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Activity className="h-4 w-4" />
            Events In / Out
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {formatCount(data?.eventsIn ?? 0)}{" "}
            <span className="text-base font-normal text-muted-foreground">/</span>{" "}
            {formatCount(data?.eventsOut ?? 0)}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Gauge className="h-4 w-4" />
            Fleet Health
          </div>
          <p className="mt-2 text-2xl font-bold tabular-nums">
            {data?.nodeCount ?? 0}{" "}
            <span className="text-base font-normal text-muted-foreground">
              {data?.nodeCount === 1 ? "node" : "nodes"}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {formatPercent((data?.errorRate ?? 0) * 100)} error rate
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
