"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import { useMatrixFilters } from "@/hooks/use-matrix-filters";
import { FleetKpiCards } from "@/components/fleet/fleet-kpi-cards";
import { FleetVolumeChart } from "@/components/fleet/fleet-volume-chart";
import { FleetThroughputChart } from "@/components/fleet/fleet-throughput-chart";
import { FleetCapacityChart } from "@/components/fleet/fleet-capacity-chart";
import { DataLossTable } from "@/components/fleet/data-loss-table";
import { DeploymentMatrix } from "@/components/fleet/deployment-matrix";
import { DeploymentMatrixToolbar } from "@/components/fleet/DeploymentMatrixToolbar";
import { FleetTabs } from "@/components/fleet/fleet-tabs";
import { FilterPresetBar } from "@/components/filter-preset/FilterPresetBar";
import { SaveFilterDialog } from "@/components/filter-preset/SaveFilterDialog";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { TimeRangeSelector } from "@/components/time-range-selector";
import { aggregateProcessStatus } from "@/lib/pipeline-status";

type TimeRange = "1h" | "6h" | "1d" | "7d" | "30d";

export default function FleetOverviewPage() {
  const trpc = useTRPC();
  const router = useRouter();
  const { selectedEnvironmentId } = useEnvironmentStore();
  const [range, setRange] = useState<TimeRange>("1d");
  const [lossThreshold, setLossThreshold] = useState(0.05);
  const polling = usePollingInterval(15_000);

  // --- Matrix filter state (URL-synced) ---
  const {
    search: matrixSearch,
    statusFilter: matrixStatusFilter,
    tagFilter: matrixTagFilter,
    hasActiveFilters: matrixHasActiveFilters,
    setSearch: setMatrixSearch,
    setStatusFilter: setMatrixStatusFilter,
    setTagFilter: setMatrixTagFilter,
  } = useMatrixFilters();

  const [saveFilterOpen, setSaveFilterOpen] = useState(false);
  const [exceptionsOnly, setExceptionsOnly] = useState(false);

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

  // --- Matrix filter preset auto-apply ---
  const defaultPresetQuery = useQuery(
    trpc.filterPreset.list.queryOptions(
      { environmentId: selectedEnvironmentId ?? "", scope: "fleet_matrix" as const },
      { enabled: !!selectedEnvironmentId },
    ),
  );

  useEffect(() => {
    if (!matrixHasActiveFilters && defaultPresetQuery.data) {
      const defaultPreset = defaultPresetQuery.data.find((p) => p.isDefault);
      if (defaultPreset) {
        const f = defaultPreset.filters as Record<string, unknown>;
        if (f.search && typeof f.search === "string") setMatrixSearch(f.search);
        if (Array.isArray(f.status) && f.status.length > 0) setMatrixStatusFilter(f.status as string[]);
        if (Array.isArray(f.tags) && f.tags.length > 0) setMatrixTagFilter(f.tags as string[]);
      }
    }
    // Only run on initial data load, not on every filter change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPresetQuery.data]);

  // Matrix pipeline data for filtering
  const matrixQuery = useQuery({
    ...trpc.fleet.listWithPipelineStatus.queryOptions({ environmentId: selectedEnvironmentId ?? "" }),
    enabled: !!selectedEnvironmentId,
  });

  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const p of matrixQuery.data?.deployedPipelines ?? []) {
      for (const t of (p.tags as string[]) ?? []) {
        tagSet.add(t);
      }
    }
    return [...tagSet].sort();
  }, [matrixQuery.data?.deployedPipelines]);

  const filteredDeployedPipelines = useMemo(() => {
    let result = matrixQuery.data?.deployedPipelines ?? [];
    const nodes = matrixQuery.data?.nodes ?? [];

    if (matrixSearch) {
      const lc = matrixSearch.toLowerCase();
      result = result.filter((p) => p.name.toLowerCase().includes(lc));
    }

    if (matrixStatusFilter.length > 0) {
      result = result.filter((p) => {
        const nodeStatuses = nodes.flatMap((n) =>
          n.pipelineStatuses.filter((s) => s.pipelineId === p.id),
        );
        const agg = aggregateProcessStatus(nodeStatuses);
        return agg !== null && matrixStatusFilter.map((s) => s.toUpperCase()).includes(agg);
      });
    }

    if (matrixTagFilter.length > 0) {
      result = result.filter((p) => {
        const pTags = (p.tags as string[]) ?? [];
        return matrixTagFilter.some((t) => pTags.includes(t));
      });
    }

    if (exceptionsOnly) {
      result = result.filter((p) => {
        const nodeStatuses = nodes.flatMap((n) =>
          n.pipelineStatuses.filter((s) => s.pipelineId === p.id),
        );
        const hasCrashed = nodeStatuses.some((s) => s.status === "CRASHED");
        const hasVersionMismatch = nodeStatuses.some(
          (s) => s.version < p.latestVersion,
        );
        const deployedOnAllNodes = nodeStatuses.length >= nodes.length;
        return hasCrashed || hasVersionMismatch || !deployedOnAllNodes;
      });
    }

    return result;
  }, [matrixQuery.data, matrixSearch, matrixStatusFilter, matrixTagFilter, exceptionsOnly]);

  // Clear matrix filters when environment changes
  const prevEnvRef = useRef(selectedEnvironmentId);
  useEffect(() => {
    if (prevEnvRef.current !== selectedEnvironmentId) {
      prevEnvRef.current = selectedEnvironmentId;
      router.replace("/fleet/overview", { scroll: false });
    }
  }, [selectedEnvironmentId, router]);

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
        <FleetTabs active="overview" />
        <TimeRangeSelector value={range} onChange={setRange} />
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

      <div className="space-y-3">
        <h3 className="text-base font-semibold">Deployment Matrix</h3>
        {matrixQuery.data && (
          <DeploymentMatrixToolbar
            search={matrixSearch}
            onSearchChange={setMatrixSearch}
            statusFilter={matrixStatusFilter}
            onStatusFilterChange={setMatrixStatusFilter}
            tagFilter={matrixTagFilter}
            onTagFilterChange={setMatrixTagFilter}
            availableTags={availableTags}
            exceptionsOnly={exceptionsOnly}
            onExceptionsOnlyChange={setExceptionsOnly}
            presetBar={
              <FilterPresetBar
                environmentId={selectedEnvironmentId}
                scope="fleet_matrix"
                currentFilters={{
                  search: matrixSearch,
                  status: matrixStatusFilter,
                  tags: matrixTagFilter,
                }}
                onApplyPreset={(filters) => {
                  const f = filters as {
                    search?: string;
                    status?: string[];
                    tags?: string[];
                  };
                  setMatrixSearch(f.search ?? "");
                  setMatrixStatusFilter(f.status ?? []);
                  setMatrixTagFilter(f.tags ?? []);
                }}
                onSaveClick={() => setSaveFilterOpen(true)}
              />
            }
          />
        )}
        {matrixHasActiveFilters ? (
          <DeploymentMatrix
            environmentId={selectedEnvironmentId}
            filteredPipelines={matrixQuery.data ? filteredDeployedPipelines : undefined}
            hasActiveFilters={matrixHasActiveFilters}
            onClearFilters={() => {
              setMatrixSearch("");
              setMatrixStatusFilter([]);
              setMatrixTagFilter([]);
            }}
          />
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-dashed p-12 text-center">
            <p className="text-sm text-muted-foreground">
              Filter by group, tag, or status to load the deployment matrix.
            </p>
          </div>
        )}
      </div>

      <SaveFilterDialog
        open={saveFilterOpen}
        onOpenChange={setSaveFilterOpen}
        environmentId={selectedEnvironmentId}
        scope="fleet_matrix"
        filters={{
          search: matrixSearch,
          status: matrixStatusFilter,
          tags: matrixTagFilter,
        }}
      />
    </div>
  );
}
