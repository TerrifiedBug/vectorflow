"use client";

import Link from "next/link";
import { useEnvironmentStore } from "@/stores/environment-store";
import { useTeamStore } from "@/stores/team-store";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { FleetHealthDashboard } from "@/components/fleet/fleet-health-dashboard";

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
      <div className="flex items-center gap-1">
        <Link
          href="/fleet"
          className="rounded-full px-3 h-7 text-xs font-medium border transition-colors bg-transparent text-muted-foreground border-border hover:bg-muted inline-flex items-center"
        >
          Nodes
        </Link>
        <Link
          href="/fleet/overview"
          className="rounded-full px-3 h-7 text-xs font-medium border transition-colors bg-transparent text-muted-foreground border-border hover:bg-muted inline-flex items-center"
        >
          Overview
        </Link>
        <span className="rounded-full px-3 h-7 text-xs font-medium border transition-colors bg-accent text-accent-foreground border-transparent inline-flex items-center">
          Health
        </span>
      </div>

      {activeEnvId && <FleetHealthDashboard environmentId={activeEnvId} />}
    </div>
  );
}
