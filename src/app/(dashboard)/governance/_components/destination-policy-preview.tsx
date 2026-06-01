"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/router";
import { useTRPC } from "@/trpc/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryError } from "@/components/query-error";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PolicyInput = inferRouterInputs<AppRouter>["governance"]["previewDestinationPolicy"];

/** Split a comma-separated field into a trimmed string[], or undefined when empty. */
function parseTypes(raw: string): string[] | undefined {
  const items = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function DestinationPolicyPreview({
  pipelines,
}: {
  pipelines: Array<{ id: string; name: string }>;
}) {
  const trpc = useTRPC();
  const [pipelineId, setPipelineId] = useState("");
  const [allowed, setAllowed] = useState("");
  const [denied, setDenied] = useState("");
  const [submitted, setSubmitted] = useState<PolicyInput | null>(null);

  const previewQuery = useQuery(
    trpc.governance.previewDestinationPolicy.queryOptions(submitted ?? { pipelineId: "" }, {
      enabled: !!submitted?.pipelineId,
    }),
  );

  const handleSubmit = () => {
    if (!pipelineId) return;
    setSubmitted({
      pipelineId,
      allowedSinkTypes: parseTypes(allowed),
      deniedSinkTypes: parseTypes(denied),
    });
  };

  const decisions = previewQuery.data?.decisions ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Destination policy preview</CardTitle>
        <CardDescription>
          Evaluate which sinks a pipeline may write to under an allow/deny policy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="gov-pipeline">Pipeline</Label>
            <Select value={pipelineId} onValueChange={setPipelineId}>
              <SelectTrigger id="gov-pipeline">
                <SelectValue
                  placeholder={pipelines.length > 0 ? "Select a pipeline" : "No pipelines available"}
                />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((pipeline) => (
                  <SelectItem key={pipeline.id} value={pipeline.id}>
                    {pipeline.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="gov-allowed">Allowed sink types</Label>
            <Input
              id="gov-allowed"
              placeholder="e.g. s3, http"
              value={allowed}
              onChange={(event) => setAllowed(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="gov-denied">Denied sink types</Label>
            <Input
              id="gov-denied"
              placeholder="e.g. kafka"
              value={denied}
              onChange={(event) => setDenied(event.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={handleSubmit} disabled={!pipelineId} className="w-full sm:w-auto">
              Evaluate policy
            </Button>
          </div>
        </div>

        {previewQuery.isError ? (
          <QueryError
            message="Failed to evaluate destination policy"
            onRetry={() => previewQuery.refetch()}
          />
        ) : submitted && previewQuery.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : !submitted ? (
          <p className="text-sm text-muted-foreground">
            Pick a pipeline and run an evaluation to preview sink decisions.
          </p>
        ) : decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">This pipeline has no sinks to evaluate.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sink</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Decision</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decisions.map((decision) => (
                <TableRow key={decision.componentKey}>
                  <TableCell className="font-mono text-xs">{decision.componentKey}</TableCell>
                  <TableCell className="font-mono text-xs">{decision.componentType}</TableCell>
                  <TableCell>
                    <StatusBadge variant={decision.decision === "allow" ? "healthy" : "error"}>
                      {decision.decision === "allow" ? "Allow" : "Deny"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{decision.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
