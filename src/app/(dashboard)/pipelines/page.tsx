"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Plus } from "lucide-react";
import { useEnvironmentStore } from "@/stores/environment-store";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export default function PipelinesPage() {
  const trpc = useTRPC();
  const selectedEnvironmentId = useEnvironmentStore((s) => s.selectedEnvironmentId);

  // Fetch teams first
  const teamsQuery = useQuery(trpc.team.list.queryOptions());
  const firstTeamId = teamsQuery.data?.[0]?.id;

  // Then fetch environments for that team
  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: firstTeamId! },
      { enabled: !!firstTeamId }
    )
  );

  const environments = environmentsQuery.data ?? [];
  const effectiveEnvId = selectedEnvironmentId || environments[0]?.id || "";

  // Fetch pipelines for the selected environment
  const pipelinesQuery = useQuery(
    trpc.pipeline.list.queryOptions(
      { environmentId: effectiveEnvId },
      { enabled: !!effectiveEnvId }
    )
  );

  const pipelines = pipelinesQuery.data ?? [];
  const isLoading =
    teamsQuery.isLoading ||
    environmentsQuery.isLoading ||
    pipelinesQuery.isLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Pipelines</h2>
          <p className="text-muted-foreground">
            Manage your data processing pipelines
          </p>
        </div>
        <Button asChild>
          <Link href="/pipelines/new">
            <Plus className="mr-2 h-4 w-4" />
            New Pipeline
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : pipelines.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No pipelines yet</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/pipelines/new">Create your first pipeline</Link>
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Components</TableHead>
              <TableHead>Last Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pipelines.map((pipeline) => (
              <TableRow key={pipeline.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/pipelines/${pipeline.id}`}
                    className="hover:underline"
                  >
                    {pipeline.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <Badge variant={pipeline.isDraft ? "secondary" : "default"}>
                    {pipeline.isDraft ? "Draft" : "Deployed"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {pipeline._count.nodes} nodes, {pipeline._count.edges} edges
                </TableCell>
                <TableCell>
                  {new Date(pipeline.updatedAt).toLocaleDateString()}
                  {pipeline.updatedBy && (
                    <span className="text-xs text-muted-foreground">
                      {" "}by {pipeline.updatedBy.name || pipeline.updatedBy.email}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
