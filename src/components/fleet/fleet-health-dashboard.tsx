"use client";

import { Suspense, useState, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { usePollingInterval } from "@/hooks/use-polling-interval";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { FleetHealthToolbar } from "@/components/fleet/fleet-health-toolbar";
import { NodeGroupHealthCard } from "@/components/fleet/node-group-health-card";
import { cn } from "@/lib/utils";

interface FleetHealthDashboardProps {
  environmentId: string;
}

function FleetHealthDashboardInner({ environmentId }: FleetHealthDashboardProps) {
  const trpc = useTRPC();
  const router = useRouter();
  const searchParams = useSearchParams();
  const polling = usePollingInterval(30_000);

  // Read filters from URL
  const groupFilter = searchParams.get("group");
  const complianceFilter = (searchParams.get("compliance") ?? "all") as
    | "all"
    | "compliant"
    | "non-compliant";
  const labelFilterRaw = searchParams.get("label");
  const labelFilter: Record<string, string> = useMemo(() => {
    if (!labelFilterRaw) return {};
    try {
      return JSON.parse(labelFilterRaw) as Record<string, string>;
    } catch {
      return {};
    }
  }, [labelFilterRaw]);

  // Expanded group state — allows multiple groups open simultaneously
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleGroup = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Write filters to URL
  const updateFilter = useCallback(
    (updates: {
      group?: string | null;
      label?: Record<string, string>;
      compliance?: "all" | "compliant" | "non-compliant";
    }) => {
      const params = new URLSearchParams(searchParams.toString());

      if ("group" in updates) {
        if (updates.group) {
          params.set("group", updates.group);
        } else {
          params.delete("group");
        }
      }
      if ("label" in updates) {
        const labelVal = updates.label;
        if (labelVal && Object.keys(labelVal).length > 0) {
          params.set("label", JSON.stringify(labelVal));
        } else {
          params.delete("label");
        }
      }
      if ("compliance" in updates) {
        if (updates.compliance && updates.compliance !== "all") {
          params.set("compliance", updates.compliance);
        } else {
          params.delete("compliance");
        }
      }

      router.replace(`/fleet/health?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  // Queries
  const healthStatsQuery = useQuery({
    ...trpc.nodeGroup.groupHealthStats.queryOptions({
      environmentId,
      ...(Object.keys(labelFilter).length > 0 ? { labels: labelFilter } : {}),
    }),
    enabled: !!environmentId,
    refetchInterval: polling,
  });

  const labelsQuery = useQuery(
    trpc.fleet.listLabels.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );

  const groupsData = healthStatsQuery.data;
  const allGroups = useMemo(() => groupsData ?? [], [groupsData]);
  const availableLabels = labelsQuery.data ?? {};
  const isLoading = healthStatsQuery.isLoading;

  // Client-side filtering
  const filteredGroups = useMemo(() => {
    let result = allGroups;

    if (groupFilter) {
      result = result.filter((g) => g.id === groupFilter);
    }

    if (complianceFilter === "compliant") {
      result = result.filter((g) => g.complianceRate === 100);
    } else if (complianceFilter === "non-compliant") {
      result = result.filter((g) => g.complianceRate < 100);
    }

    return result;
  }, [allGroups, groupFilter, complianceFilter]);

  const labelFilterActive = Object.keys(labelFilter).length > 0;

  // Aggregate fleet-wide stats for the summary bar
  const { totalNodes, totalAlerts, healthyPct } = useMemo(() => {
    const total = allGroups.reduce((sum, g) => sum + g.totalNodes, 0);
    const healthy = allGroups.reduce((sum, g) => sum + g.onlineCount, 0);
    const alerts = allGroups.reduce((sum, g) => sum + g.alertCount, 0);
    const pct = total > 0 ? Math.round((healthy / total) * 100) : 100;
    return { totalNodes: total, totalAlerts: alerts, healthyPct: pct };
  }, [allGroups]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full rounded-lg" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {allGroups.length > 0 && (
        <div className="flex items-center gap-4 rounded-lg bg-muted/50 px-4 py-3 text-sm">
          <span className="font-semibold tabular-nums">{totalNodes} nodes total</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-semibold tabular-nums">{healthyPct}% healthy</span>
          <span className="text-muted-foreground">·</span>
          <span className={cn("font-semibold tabular-nums", totalAlerts > 0 ? "text-destructive" : "text-muted-foreground")}>{totalAlerts} active alerts</span>
        </div>
      )}

      <FleetHealthToolbar
        groupFilter={groupFilter}
        onGroupFilterChange={(id) => updateFilter({ group: id })}
        labelFilter={labelFilter}
        onLabelFilterChange={(labels) => updateFilter({ label: labels })}
        complianceFilter={complianceFilter}
        onComplianceFilterChange={(status) =>
          updateFilter({ compliance: status })
        }
        groups={allGroups.map((g) => ({ id: g.id, name: g.name }))}
        availableLabels={availableLabels}
      />

      {filteredGroups.length === 0 && allGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="font-medium">No node groups defined</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create groups in Fleet Settings to organize your fleet.
          </p>
        </div>
      ) : filteredGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No groups match your filters</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => updateFilter({ group: null, label: {}, compliance: "all" })}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredGroups.map((group) => (
            <NodeGroupHealthCard
              key={group.id}
              group={group}
              isExpanded={expandedIds.has(group.id)}
              onToggle={() => toggleGroup(group.id)}
              labelFilter={labelFilter}
              labelFilterActive={labelFilterActive}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FleetHealthDashboard({
  environmentId,
}: FleetHealthDashboardProps) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-12 w-full rounded-lg" />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      }
    >
      <FleetHealthDashboardInner environmentId={environmentId} />
    </Suspense>
  );
}
