"use client";

import Link from "next/link";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/query-error";
import { pipelineStatusVariant, pipelineStatusLabel } from "@/lib/status";
import { formatLastSeen } from "@/lib/format";

type ConfigDriftReport = inferRouterOutputs<AppRouter>["fleet"]["configDriftReport"];
type ConfigDriftNode = ConfigDriftReport["nodes"][number];
type ConfigDrift = ConfigDriftNode["drift"];
type StatusVariant = "healthy" | "degraded" | "error" | "neutral" | "info";

// Single source of truth for drift tone — reused by summary tiles and table badges.
const driftVariant: Record<ConfigDrift, StatusVariant> = {
  in_sync: "healthy",
  drifted: "degraded",
  unknown: "neutral",
};

const driftLabel: Record<ConfigDrift, string> = {
  in_sync: "In sync",
  drifted: "Drifted",
  unknown: "Unknown",
};

interface FleetConfigDriftProps {
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

// The agent reports only a checksum of its running config (the full text is
// never persisted) and that checksum is derived from secret-bearing config, so
// the raw hash is never sent to the client. We surface presence only.
function presence(has: boolean): string {
  return has ? "reported" : "—";
}

export function FleetConfigDrift({ environmentId }: FleetConfigDriftProps) {
  const trpc = useTRPC();

  const reportQuery = useQuery(
    trpc.fleet.configDriftReport.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );

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
        message="Failed to load config drift report"
        onRetry={() => reportQuery.refetch()}
      />
    );
  }

  const report = reportQuery.data;
  if (!report) return null;

  const { summary, nodes } = report;

  return (
    <div id="config-drift" className="scroll-mt-20 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Config drift</CardTitle>
          <CardDescription>
            Running config each agent reports vs the desired config the server
            last served — compared per node and pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summary.total === 0 ? (
            <p className="text-sm text-muted-foreground">
              No agents reporting pipeline config in this environment.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              <SummaryStat label="Total" value={summary.total} variant="neutral" />
              <SummaryStat label="Drifted" value={summary.drifted} variant={driftVariant.drifted} />
              <SummaryStat label="In sync" value={summary.inSync} variant={driftVariant.in_sync} />
              <SummaryStat label="Unknown" value={summary.unknown} variant={driftVariant.unknown} />
            </div>
          )}
        </CardContent>
      </Card>

      {summary.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Per-node config drift</CardTitle>
            <CardDescription>
              {nodes.length} node-pipeline {nodes.length === 1 ? "pair" : "pairs"} scoped to this environment
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table density="dense">
              <TableHeader>
                <TableRow>
                  <TableHead>Node</TableHead>
                  <TableHead>Pipeline</TableHead>
                  <TableHead>Process</TableHead>
                  <TableHead>Running / desired</TableHead>
                  <TableHead>Drift</TableHead>
                  <TableHead>Last reported</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nodes.map((node) => (
                  <TableRow key={`${node.nodeId}:${node.pipelineId}`}>
                    <TableCell className="font-medium">
                      <Link href={`/fleet/${node.nodeId}`} className="hover:underline">
                        {node.nodeName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {node.pipelineName}
                    </TableCell>
                    <TableCell>
                      <StatusBadge variant={pipelineStatusVariant(node.status)}>
                        {pipelineStatusLabel(node.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      <span
                        className={
                          node.drift === "drifted"
                            ? "text-status-degraded-foreground"
                            : "text-muted-foreground"
                        }
                      >
                        {presence(node.hasRunning)}
                      </span>
                      <span className="text-muted-foreground"> / </span>
                      <span className="text-muted-foreground">
                        {presence(node.hasDesired)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge variant={driftVariant[node.drift]}>
                        {driftLabel[node.drift]}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatLastSeen(node.lastReportedAt)}
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
