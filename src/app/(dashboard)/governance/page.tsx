"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { Skeleton } from "@/components/ui/skeleton";
import { PostureSummary } from "./_components/posture-summary";
import { ComplianceSummary } from "./_components/compliance-summary";
import { DestinationPolicyPreview } from "./_components/destination-policy-preview";

export default function GovernancePage() {
  const trpc = useTRPC();
  const teamId = useTeamStore((s) => s.selectedTeamId);

  const reportQuery = useQuery(
    trpc.governance.report.queryOptions({ teamId: teamId! }, { enabled: !!teamId }),
  );

  const pipelines =
    reportQuery.data?.compliance.pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
    })) ?? [];

  return (
    <div className="min-h-full bg-bg">
      <PageHeader
        title="Governance"
        description="Compliance posture and destination-policy controls for the selected team."
      />

      <div className="space-y-6 p-4">
        {!teamId ? (
          <p className="text-sm text-muted-foreground">
            Select a team from the header to view its governance report.
          </p>
        ) : reportQuery.isError ? (
          <QueryError
            message="Failed to load governance report"
            onRetry={() => reportQuery.refetch()}
          />
        ) : reportQuery.isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : reportQuery.data ? (
          <>
            <PostureSummary posture={reportQuery.data.posture} />
            <ComplianceSummary compliance={reportQuery.data.compliance} />
            <DestinationPolicyPreview pipelines={pipelines} />
          </>
        ) : null}
      </div>
    </div>
  );
}
