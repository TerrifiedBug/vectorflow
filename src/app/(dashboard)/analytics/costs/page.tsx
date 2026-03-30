// src/app/(dashboard)/analytics/costs/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CostKpiCards } from "@/components/analytics/cost-kpi-cards";
import { CostTable } from "@/components/analytics/cost-table";
import { CostChart } from "@/components/analytics/cost-chart";
import { CostTeamRollup } from "@/components/analytics/cost-team-rollup";
import { CostEnvironmentRollup } from "@/components/analytics/cost-environment-rollup";
import { CostCsvExport } from "@/components/analytics/cost-csv-export";
import { cn } from "@/lib/utils";

type CostRange = "1d" | "7d" | "30d";

export function CostDashboard() {
  const trpc = useTRPC();
  const { selectedEnvironmentId } = useEnvironmentStore();
  const [range, setRange] = useState<CostRange>("7d");
  const [tab, setTab] = useState("pipelines");

  const pollingBase = range === "1d" ? 60_000 : 120_000;
  const pollingInterval = usePollingInterval(pollingBase);

  const summary = useQuery({
    ...trpc.analytics.costSummary.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: pollingInterval,
  });

  const topPipelines = useQuery({
    ...trpc.analytics.topPipelines.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: pollingInterval,
  });

  const pipelineCosts = useQuery({
    ...trpc.analytics.costByPipeline.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: pollingInterval,
  });

  const timeSeries = useQuery({
    ...trpc.analytics.costTimeSeries.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
      groupBy: tab === "teams" ? "team" : "pipeline",
    }),
    enabled: !!selectedEnvironmentId,
    refetchInterval: pollingInterval,
  });

  const teamCosts = useQuery({
    ...trpc.analytics.costByTeam.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId && tab === "teams",
    refetchInterval: pollingInterval,
  });

  const envCosts = useQuery({
    ...trpc.analytics.costByEnvironment.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
      range,
    }),
    enabled: !!selectedEnvironmentId && tab === "environments",
    refetchInterval: pollingInterval,
  });

  if (!selectedEnvironmentId) {
    return <EmptyState title="Select an environment to view cost analytics" />;
  }

  if (summary.isError) {
    return (
      <QueryError
        message="Failed to load cost analytics"
        onRetry={() => {
          void summary.refetch();
          void pipelineCosts.refetch();
        }}
      />
    );
  }

  if (summary.isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with range selector and CSV export */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Cost Attribution</h2>
        <div className="flex items-center gap-3">
          <CostCsvExport environmentId={selectedEnvironmentId} range={range} />
          <div className="flex items-center gap-1">
            {(["1d", "7d", "30d"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setRange(v)}
                className={cn(
                  "rounded-full px-3 h-7 text-xs font-medium border transition-colors",
                  range === v
                    ? "bg-accent text-accent-foreground border-transparent"
                    : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <CostKpiCards
        summary={summary.data ?? null}
        topPipelines={topPipelines.data ?? []}
        range={range}
      />

      {/* Volume Trend Chart */}
      <CostChart
        data={timeSeries.data ?? []}
        range={range}
        isLoading={timeSeries.isLoading}
      />

      {/* Tabbed views */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="pipelines">Per Pipeline</TabsTrigger>
          <TabsTrigger value="teams">By Team</TabsTrigger>
          <TabsTrigger value="environments">By Environment</TabsTrigger>
        </TabsList>

        <TabsContent value="pipelines">
          <CostTable
            rows={pipelineCosts.data ?? []}
            isLoading={pipelineCosts.isLoading}
          />
        </TabsContent>

        <TabsContent value="teams">
          <CostTeamRollup
            rows={teamCosts.data ?? []}
            isLoading={teamCosts.isLoading}
          />
        </TabsContent>

        <TabsContent value="environments">
          <CostEnvironmentRollup
            rows={envCosts.data ?? []}
            isLoading={envCosts.isLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function CostDashboardRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/analytics?tab=costs");
  }, [router]);
  return null;
}
