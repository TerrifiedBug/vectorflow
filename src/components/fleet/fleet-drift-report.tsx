"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useTRPC } from "@/trpc/client";
import type { AppRouter } from "@/trpc/router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { nodeStatusVariant, nodeStatusLabel } from "@/lib/status";

type DriftReport = inferRouterOutputs<AppRouter>["fleet"]["agentDriftReport"];
type DriftNode = DriftReport["nodes"][number];
type Drift = DriftNode["drift"];
type StatusVariant = "healthy" | "degraded" | "error" | "neutral" | "info";

// Single source of truth for drift tone — reused by summary tiles and table badges.
const driftVariant: Record<Drift, StatusVariant> = {
  current: "healthy",
  behind: "degraded",
  unknown: "neutral",
};

const driftLabel: Record<Drift, string> = {
  current: "Current",
  behind: "Behind",
  unknown: "Unknown",
};

const deploymentModeLabel: Record<string, string> = {
  STANDALONE: "Standalone",
  DOCKER: "Docker",
  UNKNOWN: "Unknown",
};

interface FleetDriftReportProps {
  environmentId: string;
}

function SummaryStat({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: StatusVariant;
}) {
  return (
    <div className="flex min-w-[104px] flex-col gap-2 rounded-lg border border-line bg-bg-2 px-3 py-2.5">
      <span className="text-2xl font-semibold tabular-nums text-fg">{value}</span>
      <StatusBadge variant={variant}>{label}</StatusBadge>
    </div>
  );
}

export function FleetDriftReport({ environmentId }: FleetDriftReportProps) {
  const trpc = useTRPC();

  // Reuse the exact latest-agent-version query the main fleet page uses.
  const versionQuery = useQuery(
    trpc.settings.checkVersion.queryOptions(undefined, {
      refetchInterval: false,
      staleTime: 5 * 60 * 1000,
    }),
  );
  const targetVersion = versionQuery.data?.agent.latestVersion ?? null;

  const reportQuery = useQuery(
    trpc.fleet.agentDriftReport.queryOptions(
      { environmentId, targetVersion: targetVersion ?? "" },
      { enabled: !!environmentId && !!targetVersion },
    ),
  );

  if (versionQuery.isLoading) {
    return <Skeleton className="h-28 w-full rounded-xl" />;
  }

  // Latest stable version could not be resolved — never call the report with "".
  if (!targetVersion) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Agent version drift</CardTitle>
          <CardDescription className="text-muted-foreground">
            Latest agent version unavailable — drift cannot be computed.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (reportQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (reportQuery.isError) {
    return (
      <QueryError
        message="Failed to load agent drift report"
        onRetry={() => reportQuery.refetch()}
      />
    );
  }

  const report = reportQuery.data;
  if (!report) return null;

  const { summary, nodes } = report;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Agent version drift</CardTitle>
          <CardDescription>
            Target agent version{" "}
            <span className="font-mono tabular-nums text-fg">{report.targetVersion}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.total === 0 ? (
            <p className="text-sm text-muted-foreground">No agents in this environment.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              <SummaryStat label="Total" value={summary.total} variant="neutral" />
              <SummaryStat label="Behind" value={summary.behind} variant={driftVariant.behind} />
              <SummaryStat label="Current" value={summary.current} variant={driftVariant.current} />
              <SummaryStat label="Unknown" value={summary.unknown} variant={driftVariant.unknown} />
              <SummaryStat label="Docker" value={summary.docker} variant="info" />
            </div>
          )}
        </CardContent>
      </Card>

      {summary.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per-node drift</CardTitle>
            <CardDescription>
              {nodes.length} {nodes.length === 1 ? "agent" : "agents"} scoped to this environment
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table density="dense">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Deployment mode</TableHead>
                  <TableHead>Agent version</TableHead>
                  <TableHead>Drift</TableHead>
                  <TableHead className="text-center">Auto-update eligible</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Link href={`/fleet/${node.id}`} className="hover:underline">
                          {node.name}
                        </Link>
                        {node.pendingAction && (
                          <Badge variant="info">Update pending</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge variant={nodeStatusVariant(node.status)}>
                        {nodeStatusLabel(node.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {deploymentModeLabel[node.deploymentMode] ?? node.deploymentMode}
                    </TableCell>
                    <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                      {node.agentVersion ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge variant={driftVariant[node.drift]}>
                        {driftLabel[node.drift]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-center">
                      {node.autoUpdateEligible ? (
                        <>
                          <Check className="mx-auto h-4 w-4 text-status-healthy" aria-hidden />
                          <span className="sr-only">Eligible</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden className="text-muted-foreground">—</span>
                          <span className="sr-only">Not eligible</span>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
