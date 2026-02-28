"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Plus } from "lucide-react";

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

export default function EnvironmentsPage() {
  const trpc = useTRPC();

  const teamsQuery = useQuery(trpc.team.list.queryOptions());

  const firstTeamId = teamsQuery.data?.[0]?.id;

  const environmentsQuery = useQuery(
    trpc.environment.list.queryOptions(
      { teamId: firstTeamId! },
      { enabled: !!firstTeamId }
    )
  );

  const isLoading = teamsQuery.isLoading || environmentsQuery.isLoading;
  const environments = environmentsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Environments</h2>
          <p className="text-muted-foreground">
            Manage your deployment environments
          </p>
        </div>
        <Button asChild>
          <Link href="/environments/new">
            <Plus className="mr-2 h-4 w-4" />
            New Environment
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : environments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
          <p className="text-muted-foreground">No environments yet</p>
          <Button asChild className="mt-4" variant="outline">
            <Link href="/environments/new">Create your first environment</Link>
          </Button>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Nodes</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {environments.map((env) => (
              <TableRow key={env.id}>
                <TableCell className="font-medium">
                  <Link
                    href={`/environments/${env.id}`}
                    className="hover:underline"
                  >
                    {env.name}
                  </Link>
                </TableCell>
                <TableCell>{env._count.nodes}</TableCell>
                <TableCell>
                  {new Date(env.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
