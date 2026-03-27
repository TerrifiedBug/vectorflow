"use client";

import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { FleetHealthDashboard } from "@/components/fleet/fleet-health-dashboard";
import { FleetTabs } from "@/components/fleet/fleet-tabs";

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
    <div className="space-y-6">
      <FleetTabs active="health" />

      {activeEnvId && <FleetHealthDashboard environmentId={activeEnvId} />}
    </div>
  );
}
