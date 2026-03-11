"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface UptimeCardsProps {
  nodeId: string;
}

function uptimeColor(percent: number): string {
  if (percent >= 99.5) return "text-green-600";
  if (percent >= 99.0) return "text-amber-600";
  return "text-red-600";
}

function UptimeCard({
  title,
  nodeId,
  range,
}: {
  title: string;
  nodeId: string;
  range: "1d" | "7d" | "30d";
}) {
  const trpc = useTRPC();

  const { data, isLoading } = useQuery({
    ...trpc.fleet.getUptime.queryOptions({ nodeId, range }),
    refetchInterval: 15_000,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-1">
            <Skeleton className="h-8 w-24 rounded" />
            <Skeleton className="h-4 w-16 rounded" />
          </div>
        ) : data == null ? (
          <div>
            <p className="text-2xl font-bold">—</p>
          </div>
        ) : (
          <div>
            <p className={`text-2xl font-bold ${uptimeColor(data.uptimePercent)}`}>
              {data.uptimePercent.toFixed(2)}%
            </p>
            <p className="text-xs text-muted-foreground">
              {data.incidents} incident{data.incidents !== 1 ? "s" : ""}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function UptimeCards({ nodeId }: UptimeCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <UptimeCard title="24h Uptime" nodeId={nodeId} range="1d" />
      <UptimeCard title="7d Uptime" nodeId={nodeId} range="7d" />
      <UptimeCard title="30d Uptime" nodeId={nodeId} range="30d" />
    </div>
  );
}
