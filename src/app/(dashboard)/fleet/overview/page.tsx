"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import { FleetKpiCards } from "@/components/fleet/fleet-kpi-cards";
import { FleetVolumeChart } from "@/components/fleet/fleet-volume-chart";
import { FleetThroughputChart } from "@/components/fleet/fleet-throughput-chart";
import { FleetCapacityChart } from "@/components/fleet/fleet-capacity-chart";
import { DataLossTable } from "@/components/fleet/data-loss-table";
import { DeploymentMatrix } from "@/components/fleet/deployment-matrix";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

type TimeRange = "1h" | "6h" | "1d" | "7d" | "30d";

export default function FleetOverviewPage() {
  const trpc = useTRPC();
  const { selectedEnvironmentId } = useEnvironmentStore();
  const [range, setRange] = useState<TimeRange>("1d");
  const [lossThreshold, setLossThreshold] = useState(0.05);
  const polling = usePollingInterval(15_000);

  const overview = useQuery({
    ...trpc.fleet.overview.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });

  const volumeTrend = useQuery({
    ...trpc.fleet.volumeTrend.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });

  const nodeThroughput = useQuery({
    ...trpc.fleet.nodeThroughput.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });

  const nodeCapacity = useQuery({
    ...trpc.fleet.nodeCapacity.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });

  const dataLoss = useQuery({
    ...trpc.fleet.dataLoss.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
      threshold: lossThreshold,
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });

  const matrixThroughput = useQuery({
    ...trpc.fleet.matrixThroughput.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: polling,
  });

  if (!selectedEnvironmentId) {
    return (
      <div className="space-y-6">
        <EmptyState title="Select an environment to view fleet overview" />
      </div>
    );
  }

  if (overview.isError) {
    return (
      <div className="space-y-6">
        <QueryError
          message="Failed to load fleet overview"
          onRetry={() => overview.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/fleet"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Fleet
          </Link>
          <h1 className="text-2xl font-bold">Fleet Overview</h1>
        </div>
        <div className="flex items-center gap-1">
          {(["1h", "6h", "1d", "7d", "30d"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setRange(v)}
              className={cn(
                "rounded-full px-3 h-7 text-xs font-medium border transition-colors",
                range === v
                  ? "bg-accent text-accent-foreground border-transparent"
                  : "bg-transparent text-muted-foreground border-border hover:bg-muted",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <FleetKpiCards data={overview.data} isLoading={overview.isLoading} />

      <FleetVolumeChart
        data={volumeTrend.data}
        isLoading={volumeTrend.isLoading}
        range={range}
      />

      <FleetThroughputChart
        data={nodeThroughput.data}
        isLoading={nodeThroughput.isLoading}
      />

      <FleetCapacityChart
        data={nodeCapacity.data}
        isLoading={nodeCapacity.isLoading}
        range={range}
      />

      <DataLossTable
        data={dataLoss.data}
        isLoading={dataLoss.isLoading}
        threshold={lossThreshold}
        onThresholdChange={setLossThreshold}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Deployment Matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <DeploymentMatrix
            environmentId={selectedEnvironmentId}
            range={range}
            lossThreshold={lossThreshold}
            throughputData={matrixThroughput.data}
          />
        </CardContent>
      </Card>
    </div>
  );
}
