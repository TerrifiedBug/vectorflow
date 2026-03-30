"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useTeamStore } from "@/stores/team-store";
import { Plus, GitBranch } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { PageHeader } from "@/components/page-header";

export default function EnvironmentsPage() {
  const trpc = useTRPC();

  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: selectedTeamId! },
      { enabled: !!selectedTeamId }
    )
  );

  const isLoading = environmentsQuery.isLoading;
  const environments = environmentsQuery.data ?? [];

  if (environmentsQuery.isError) {
    return (
      <div className="space-y-6">
        <QueryError message="Failed to load environments" onRetry={() => environmentsQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Environments"
        description="Manage deployment environments for your team."
        actions={
          <Button asChild size="sm">
            <Link href="/environments/new">
              <Plus className="mr-2 h-4 w-4" />
              New Environment
            </Link>
          </Button>
        }
      />
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : environments.length === 0 ? (
        <EmptyState
          title="No environments yet"
          action={{ label: "Create your first environment", href: "/environments/new" }}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Nodes</TableHead>
              <TableHead className="text-right">Pipelines</TableHead>
              <TableHead className="text-right">Alert Rules</TableHead>
              <TableHead>Last Deployment</TableHead>
              <TableHead>Git Sync</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {environments.map((env) => {
              const lastDeployedAt = env.pipelines?.[0]?.deployedAt;
              return (
                <TableRow key={env.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/environments/${env.id}`}
                        className="hover:underline"
                      >
                        {env.name}
                      </Link>
                      {env._count.gitSyncJobs > 0 && (
                        <Badge variant="destructive" className="text-xs">
                          {env._count.gitSyncJobs} sync {env._count.gitSyncJobs === 1 ? "failure" : "failures"}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {env._count.nodes}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {env._count.pipelines}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {env._count.alertRules}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {lastDeployedAt
                      ? new Date(lastDeployedAt).toLocaleDateString()
                      : "Never"}
                  </TableCell>
                  <TableCell>
                    {env.gitRepoUrl ? (
                      <Badge variant="outline" className="gap-1 text-xs">
                        <GitBranch className="h-3 w-3" />
                        {env.gitOpsMode === "push" ? "Push" : env.gitOpsMode === "pull" ? "Pull" : "Sync"}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">&mdash;</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(env.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
