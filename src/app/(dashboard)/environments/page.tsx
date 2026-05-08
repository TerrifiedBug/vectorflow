"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MoreHorizontal, Plus, Rocket } from "lucide-react";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { PageHeader, PageHeaderMetaSep } from "@/components/ui/page-header";
import { NewPromotionButton } from "@/components/new-promotion-button";

const ENV_COLORS = [
  "var(--accent-brand)",
  "var(--node-transform)",
  "var(--chart-3)",
  "var(--status-degraded)",
  "var(--chart-4)",
];

/**
 * v2 environments index (D1): compact environment cards with nodes and pipelines as primary signals.
 */
export default function EnvironmentsPage() {
  const trpc = useTRPC();
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId },
    ),
  );

  const environments = useMemo(() => environmentsQuery.data ?? [], [environmentsQuery.data]);
  const summary = useMemo(() => {
    const nodes = environments.reduce((sum, env) => sum + env._count.nodes, 0);
    const pipelines = environments.reduce((sum, env) => sum + env._count.pipelines, 0);
    const syncFailures = environments.reduce((sum, env) => sum + env._count.gitSyncJobs, 0);
    return { nodes, pipelines, syncFailures };
  }, [environments]);

  if (environmentsQuery.isError) {
    return <QueryError message="Failed to load environments" onRetry={() => environmentsQuery.refetch()} />;
  }

  return (
    <div className="min-h-full bg-bg text-fg">
      <PageHeader
        title="Environments"
        subtitle="Logical groupings of nodes for promotion and isolation."
        meta={
          selectedTeamId ? (
            <>
              <span>{environments.length} environments</span>
              <PageHeaderMetaSep />
              <span>{summary.nodes} nodes</span>
              <PageHeaderMetaSep />
              <span>{summary.pipelines} pipelines</span>
              {summary.syncFailures > 0 && (
                <>
                  <PageHeaderMetaSep />
                  <span className="text-status-error">{summary.syncFailures} sync failures</span>
                </>
              )}
            </>
          ) : (
            <span>Select a team</span>
          )
        }
        actions={
          <>
            <NewPromotionButton
              variant="outline"
              size="sm"
              label="Promote pipeline"
              icon={<Rocket className="h-3.5 w-3.5" />}
            />
            <Button asChild variant="primary" size="sm">
              <Link href="/environments/new">
                <Plus className="h-3.5 w-3.5" />
                New environment
              </Link>
            </Button>
          </>
        }
      />

      <div className="p-4">

      {!selectedTeamId || environmentsQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-44 w-full" />
          ))}
        </div>
      ) : environments.length === 0 ? (
        <EmptyState
          title="No environments yet"
          description="Create an environment before enrolling nodes or deploying pipelines."
          action={{ label: "Create your first environment", href: "/environments/new" }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {environments.map((env, index) => {
            const color = ENV_COLORS[index % ENV_COLORS.length];
            const lastDeployedAt = env.pipelines?.[0]?.deployedAt;
            return (
              <Link key={env.id} href={`/environments/${env.id}`} className="group block">
                <Card className="h-full border-line bg-bg-2 transition-colors hover:border-line-2 hover:bg-bg-3/50">
                  <CardHeader className="border-b border-line bg-bg-1/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="relative h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: color, boxShadow: `0 0 18px ${color}` }}
                          />
                          <h2 className="truncate font-mono text-[16px] font-medium text-fg">{env.name}</h2>
                          <Badge variant="outline" className="rounded-[3px] font-mono text-[10px] uppercase tracking-[0.04em]">
                            {env.teamId ? "team" : "system"}
                          </Badge>
                        </div>
                        <div className="mt-2 font-mono text-[11px] text-fg-2">
                          {env.gitRepoUrl ? compactRepo(env.gitRepoUrl) : "manual deploys"}
                        </div>
                      </div>
                      <MoreHorizontal className="h-4 w-4 text-fg-3 transition-colors group-hover:text-fg-1" />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 p-4">
                    <div className="grid grid-cols-2 gap-2 font-mono">
                      <Metric label="nodes" value={env._count.nodes} />
                      <Metric label="pipelines" value={env._count.pipelines} />
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-line pt-3 font-mono text-[11px] text-fg-2">
                      <span>{lastDeployedAt ? `activity ${formatShortDate(lastDeployedAt)}` : "no recent deploys"}</span>
                      <span>created {formatShortDate(env.createdAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[3px] border border-line bg-bg-1 px-3 py-2">
      <div className="font-mono text-[22px] leading-none text-fg">{value.toLocaleString()}</div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.05em] text-fg-2">{label}</div>
    </div>
  );
}


function compactRepo(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/^github\.com\//, "");
}

function formatShortDate(value: string | Date) {
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
