"use client";

import { useState, Fragment } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { ChevronDown, ChevronRight, ExternalLink, Rocket } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimestamp } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";

const ALL_VALUE = "__all__";

/** Color map for deployment action types */
function getDeployActionColor(action: string): string {
  if (action.includes("undeploy"))
    return "bg-red-500/15 text-red-700 dark:text-red-400";
  if (action.includes("rollback"))
    return "bg-orange-500/15 text-orange-700 dark:text-orange-400";
  if (action.includes("request") || action.includes("Request"))
    return "bg-blue-500/15 text-blue-700 dark:text-blue-400";
  if (action.includes("deploy"))
    return "bg-purple-500/15 text-purple-700 dark:text-purple-400";
  return "bg-gray-500/15 text-gray-700 dark:text-gray-400";
}

/** Human-friendly label for deployment actions */
function formatDeployAction(action: string): string {
  const labels: Record<string, string> = {
    "deploy.agent": "Deploy (Agent)",
    "deploy.from_version": "Deploy (Version)",
    "deploy.undeploy": "Undeploy",
    "deploy.request_submitted": "Request Submitted",
    "deployRequest.approved": "Request Approved",
    "deployRequest.deployed": "Request Deployed",
    "deployRequest.rejected": "Request Rejected",
    "deploy.cancel_request": "Request Cancelled",
    "pipeline.rollback": "Rollback",
  };
  return labels[action] ?? action;
}

export default function DeploymentHistoryPage() {
  const trpc = useTRPC();

  // Filter state
  const [pipelineFilter, setPipelineFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Expanded row tracking
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Fetch pipeline filter options
  const pipelinesQuery = useQuery(
    trpc.audit.deploymentPipelines.queryOptions()
  );
  const pipelines = pipelinesQuery.data ?? [];

  // Build query input
  const queryInput = {
    ...(pipelineFilter ? { pipelineId: pipelineFilter } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };

  // Infinite query for cursor-based pagination
  const deploymentsQuery = useInfiniteQuery(
    trpc.audit.deployments.infiniteQueryOptions(queryInput, {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
    })
  );

  const allItems =
    deploymentsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  function toggleRow(id: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const hasFilters = !!(pipelineFilter || startDate || endDate);

  if (deploymentsQuery.isError) {
    return (
      <div className="space-y-6">
        <QueryError
          message="Failed to load deployment history"
          onRetry={() => deploymentsQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Deployment History
        </h1>
        <p className="text-sm text-muted-foreground">
          Chronological timeline of deploy, undeploy, and rollback actions
        </p>
      </div>

      {/* Filter bar */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            {/* Pipeline filter */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="deploy-pipeline"
                className="text-xs text-muted-foreground"
              >
                Pipeline
              </label>
              <Select
                value={pipelineFilter || ALL_VALUE}
                onValueChange={(v) =>
                  setPipelineFilter(v === ALL_VALUE ? "" : v)
                }
              >
                <SelectTrigger id="deploy-pipeline" className="w-[220px]">
                  <SelectValue placeholder="All pipelines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>All pipelines</SelectItem>
                  {pipelines.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date range */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="deploy-from"
                className="text-xs text-muted-foreground"
              >
                From
              </label>
              <Input
                id="deploy-from"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-[160px]"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label
                htmlFor="deploy-to"
                className="text-xs text-muted-foreground"
              >
                To
              </label>
              <Input
                id="deploy-to"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-[160px]"
              />
            </div>

            {/* Clear filters */}
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPipelineFilter("");
                  setStartDate("");
                  setEndDate("");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      {deploymentsQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : allItems.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="No deployment events found"
          description="Deployment actions will appear here as pipelines are deployed, undeployed, or rolled back"
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]" />
                  <TableHead className="whitespace-nowrap">Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Pipeline</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Version</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allItems.map((entry) => {
                  const isExpanded = expandedRows.has(entry.id);
                  const hasChangelog = !!entry.changelog;
                  const hasPipelineLink = !!entry.pipelineId;
                  const hasExpandContent = hasChangelog || hasPipelineLink;

                  return (
                    <Fragment key={entry.id}>
                      <TableRow
                        className={
                          hasExpandContent ? "cursor-pointer" : ""
                        }
                        onClick={() =>
                          hasExpandContent && toggleRow(entry.id)
                        }
                      >
                        <TableCell className="w-[30px] px-2">
                          {hasExpandContent &&
                            (isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            ))}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {formatTimestamp(entry.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={`max-w-full truncate ${getDeployActionColor(entry.action)}`}
                            title={entry.action}
                          >
                            {formatDeployAction(entry.action)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {entry.pipelineName ?? "—"}
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {entry.user?.name ??
                              entry.user?.email ??
                              "—"}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular-nums">
                          {entry.versionInfo ?? "—"}
                        </TableCell>
                      </TableRow>
                      {isExpanded && hasExpandContent && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={6} className="p-4">
                            <div className="space-y-3">
                              {hasChangelog && (
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground mb-2">
                                    Changelog
                                  </p>
                                  <p className="text-sm whitespace-pre-wrap">
                                    {entry.changelog}
                                  </p>
                                </div>
                              )}
                              {hasPipelineLink && (
                                <div>
                                  <Link
                                    href={`/pipelines/${entry.pipelineId}`}
                                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    View Version History
                                  </Link>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Load more */}
          {deploymentsQuery.hasNextPage && (
            <div className="flex justify-center pt-4">
              <Button
                variant="outline"
                onClick={() => deploymentsQuery.fetchNextPage()}
                disabled={deploymentsQuery.isFetchingNextPage}
              >
                {deploymentsQuery.isFetchingNextPage
                  ? "Loading more..."
                  : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
