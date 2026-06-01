"use client";

import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { FleetHealthDashboard } from "@/components/fleet/fleet-health-dashboard";
import { FleetDriftReport } from "@/components/fleet/fleet-drift-report";
import { FleetTabs } from "@/components/fleet/fleet-tabs";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader, PageHeaderMetaSep } from "@/components/ui/page-header";

export default function FleetHealthPage() {
  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore(
    (s) => s.selectedEnvironmentId,
  );
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );

  const environments = environmentsQuery.data ?? [];
  const activeEnvId =
    selectedEnvironmentId || environments[0]?.id || "";

  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Fleet health"
        subtitle="Group-level node compliance, alert pressure, version drift, and drill-in paths for operators."
        meta={
          <>
            <span>{environments.length} environments</span>
            <PageHeaderMetaSep />
            <span>{activeEnvId ? "environment selected" : "no environment selected"}</span>
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm" className="font-mono text-[11px] uppercase tracking-[0.04em]">
            <Link href="/fleet/overview">Open fleet overview</Link>
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <FleetTabs active="health" />

        {activeEnvId ? (
          <>
            <FleetHealthDashboard environmentId={activeEnvId} />
            <FleetDriftReport environmentId={activeEnvId} />
          </>
        ) : (
          <EmptyState
            glyph="◇"
            title="Select an environment"
            description="Fleet health is scoped to one environment so compliance and drift counts do not mix production, staging, and local nodes."
            action={{ label: "Open fleet overview", href: "/fleet/overview" }}
          />
        )}
      </div>
    </div>
  );
}
