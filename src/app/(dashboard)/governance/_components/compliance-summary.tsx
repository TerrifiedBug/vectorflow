"use client";

import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Compliance = inferRouterOutputs<AppRouter>["governance"]["report"]["compliance"];

function protectionTone(summary: Compliance["summary"]) {
  if (summary.sinks === 0) return "neutral" as const;
  if (summary.unprotectedSinks === 0) return "healthy" as const;
  if (summary.protectedSinks === 0) return "error" as const;
  return "degraded" as const;
}

export function ComplianceSummary({ compliance }: { compliance: Compliance }) {
  const { summary, pipelines } = compliance;

  const stats = [
    { label: "Pipelines", value: summary.pipelines },
    { label: "Sinks", value: summary.sinks },
    { label: "Protected sinks", value: summary.protectedSinks },
    { label: "Unprotected sinks", value: summary.unprotectedSinks },
    { label: "DLP transforms", value: summary.dlpTransforms },
  ];

  const sinkRows = pipelines.flatMap((pipeline) =>
    pipeline.sinks.map((sink) => ({ pipelineName: pipeline.name, ...sink })),
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Compliance report</CardTitle>
            <CardDescription>
              Sink protection coverage across the team&apos;s pipelines.
            </CardDescription>
          </div>
          <StatusBadge variant={protectionTone(summary)}>
            {summary.protectedSinks}/{summary.sinks} protected
          </StatusBadge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-md border border-line p-3">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="font-mono text-lg text-fg">{stat.value}</p>
            </div>
          ))}
        </div>

        {sinkRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sinks found for this team.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pipeline</TableHead>
                <TableHead>Sink</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Redacted fields</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sinkRows.map((sink) => (
                <TableRow key={sink.id}>
                  <TableCell className="text-muted-foreground">{sink.pipelineName}</TableCell>
                  <TableCell className="font-medium text-fg">
                    {sink.displayName ?? sink.componentKey}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{sink.componentType}</TableCell>
                  <TableCell>
                    <StatusBadge variant={sink.protected ? "healthy" : "error"}>
                      {sink.protected ? "Protected" : "Unprotected"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {sink.redactedFields.length > 0 ? sink.redactedFields.join(", ") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
