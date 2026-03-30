"use client";

import { Fragment, useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Activity,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Constants ───────────────────────────────────────────────────────────────

const ANOMALY_TYPE_LABELS: Record<string, string> = {
  throughput_drop: "Throughput Drop",
  throughput_spike: "Throughput Spike",
  error_rate_spike: "Error Rate Spike",
  latency_spike: "Latency Spike",
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  warning:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  critical: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
};

function formatTimestamp(date: Date | string | null): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString();
}

function getStatusBadgeVariant(status: string) {
  if (status === "open") return "error" as const;
  if (status === "acknowledged") return "degraded" as const;
  return "healthy" as const;
}

function getStatusLabel(status: string) {
  if (status === "open") return "Open";
  if (status === "acknowledged") return "Acknowledged";
  return "Dismissed";
}

// ─── Types ───────────────────────────────────────────────────────────────────

type AnomalyItem = {
  id: string;
  pipelineId: string;
  anomalyType: string;
  severity: string;
  metricName: string;
  currentValue: number;
  baselineMean: number;
  baselineStddev: number;
  deviationFactor: number;
  message: string | null;
  status: string;
  detectedAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  dismissedAt: Date | null;
  dismissedBy: string | null;
  pipeline: { id: string; name: string };
};

// ─── Severity Badge ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info;
  const label =
    severity.charAt(0).toUpperCase() + severity.slice(1);

  return (
    <Badge
      variant="outline"
      className={cn("border-transparent capitalize", style)}
    >
      {label}
    </Badge>
  );
}

// ─── Expanded Row Detail ──────────────────────────────────────────────────────

function AnomalyDetailRow({ anomaly }: { anomaly: AnomalyItem }) {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-2 p-4 text-sm md:grid-cols-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">Metric</p>
        <p className="font-mono">{anomaly.metricName}</p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Current Value
        </p>
        <p className="font-mono tabular-nums">
          {anomaly.currentValue.toFixed(4)}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Baseline Mean ± Std Dev
        </p>
        <p className="font-mono tabular-nums">
          {anomaly.baselineMean.toFixed(4)} ±{" "}
          {anomaly.baselineStddev.toFixed(4)}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">
          Deviation Factor
        </p>
        <p className="font-mono tabular-nums">
          {anomaly.deviationFactor.toFixed(2)}σ
        </p>
      </div>
      {anomaly.message && (
        <div className="col-span-2 md:col-span-3">
          <p className="text-xs font-medium text-muted-foreground">Message</p>
          <p className="text-muted-foreground">{anomaly.message}</p>
        </div>
      )}
      {anomaly.acknowledgedAt && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Acknowledged
          </p>
          <p>
            {formatTimestamp(anomaly.acknowledgedAt)}
            {anomaly.acknowledgedBy && (
              <span className="text-muted-foreground">
                {" "}
                by {anomaly.acknowledgedBy}
              </span>
            )}
          </p>
        </div>
      )}
      {anomaly.dismissedAt && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Dismissed</p>
          <p>
            {formatTimestamp(anomaly.dismissedAt)}
            {anomaly.dismissedBy && (
              <span className="text-muted-foreground">
                {" "}
                by {anomaly.dismissedBy}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function AnomalyHistorySection({
  environmentId,
}: {
  environmentId: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allItems, setAllItems] = useState<AnomalyItem[]>([]);

  // ─── Server-side filter ───────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // ─── Client-side filters ──────────────────────────────────────────────────
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [pipelineFilter, setPipelineFilter] = useState<string>("all");

  // ─── Reset pagination when server-side filter changes ────────────────────
  const applyStatusFilter = (value: string) => {
    setStatusFilter(value);
    setSeverityFilter("all");
    setPipelineFilter("all");
    setCursor(undefined);
    setAllItems([]);
  };

  // ─── Query ────────────────────────────────────────────────────────────────
  const listQuery = useQuery(
    trpc.anomaly.list.queryOptions(
      {
        environmentId,
        limit: 50,
        cursor,
        ...(statusFilter !== "all"
          ? {
              status: statusFilter as "open" | "acknowledged" | "dismissed",
            }
          : {}),
      },
      { enabled: !!environmentId, placeholderData: keepPreviousData },
    ),
  );

  // ─── Derived data ─────────────────────────────────────────────────────────

  // The router returns a flat array (not { items, nextCursor })
  const pageItems = useMemo(
    () => (listQuery.data ?? []) as AnomalyItem[],
    [listQuery.data],
  );
  const nextCursor =
    pageItems.length === 50 ? pageItems[pageItems.length - 1]?.id : undefined;

  // Merge accumulated pages with current page so new data appears immediately
  const visibleItems = useMemo(() => {
    if (!cursor) return pageItems;
    const existing = new Set(allItems.map((i) => i.id));
    const newItems = pageItems.filter((i) => !existing.has(i.id));
    return [...allItems, ...newItems];
  }, [allItems, pageItems, cursor]);

  // Pipeline options derived from all loaded items
  const pipelineOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const item of visibleItems) {
      if (!seen.has(item.pipelineId)) {
        seen.set(item.pipelineId, item.pipeline.name);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [visibleItems]);

  // Client-side filtering
  const filteredItems = useMemo(() => {
    return visibleItems.filter((item) => {
      if (severityFilter !== "all" && item.severity !== severityFilter) {
        return false;
      }
      if (pipelineFilter !== "all" && item.pipelineId !== pipelineFilter) {
        return false;
      }
      return true;
    });
  }, [visibleItems, severityFilter, pipelineFilter]);

  const hasFilters =
    statusFilter !== "all" ||
    severityFilter !== "all" ||
    pipelineFilter !== "all";

  // ─── Query invalidation helper ────────────────────────────────────────────
  const invalidateAnomalies = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: trpc.anomaly.list.queryKey({ environmentId }),
    });
    queryClient.invalidateQueries({
      queryKey: trpc.anomaly.countByPipeline.queryKey({ environmentId }),
    });
  }, [queryClient, trpc, environmentId]);

  // ─── Mutations ────────────────────────────────────────────────────────────
  const acknowledgeMutation = useMutation(
    trpc.anomaly.acknowledge.mutationOptions({
      onSuccess: () => {
        toast.success("Anomaly acknowledged");
        invalidateAnomalies();
        setCursor(undefined);
        setAllItems([]);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to acknowledge anomaly", {
          duration: 6000,
        });
      },
    }),
  );

  const dismissMutation = useMutation(
    trpc.anomaly.dismiss.mutationOptions({
      onSuccess: () => {
        toast.success("Anomaly dismissed");
        invalidateAnomalies();
        setCursor(undefined);
        setAllItems([]);
      },
      onError: (error) => {
        toast.error(error.message || "Failed to dismiss anomaly", {
          duration: 6000,
        });
      },
    }),
  );

  // ─── Handlers ─────────────────────────────────────────────────────────────
  const handleLoadMore = () => {
    if (nextCursor) {
      setAllItems(visibleItems);
      setCursor(nextCursor);
    }
  };

  const handleAcknowledge = useCallback(
    (anomalyId: string) => {
      acknowledgeMutation.mutate({ environmentId, anomalyId });
    },
    [acknowledgeMutation, environmentId],
  );

  const handleDismiss = useCallback(
    (anomalyId: string) => {
      dismissMutation.mutate({ environmentId, anomalyId });
    },
    [dismissMutation, environmentId],
  );

  const isInitialLoading = listQuery.isLoading && !cursor;
  const isFetchingMore = listQuery.isFetching && !!cursor;
  const isMutating =
    acknowledgeMutation.isPending || dismissMutation.isPending;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Anomaly History</h3>
      </div>

      {listQuery.isError ? (
        <QueryError
          message="Failed to load anomaly history"
          onRetry={() => listQuery.refetch()}
        />
      ) : isInitialLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          {/* ── Filters ── */}
          <div className="flex flex-wrap items-center gap-3">
            <Select value={statusFilter} onValueChange={applyStatusFilter}>
              <SelectTrigger className="h-9 w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="acknowledged">Acknowledged</SelectItem>
                <SelectItem value="dismissed">Dismissed</SelectItem>
              </SelectContent>
            </Select>

            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>

            {pipelineOptions.length > 0 && (
              <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
                <SelectTrigger className="h-9 w-48">
                  <SelectValue placeholder="Pipeline" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Pipelines</SelectItem>
                  {pipelineOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => {
                  setStatusFilter("all");
                  setSeverityFilter("all");
                  setPipelineFilter("all");
                  setCursor(undefined);
                  setAllItems([]);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          {/* ── Table or empty state ── */}
          {filteredItems.length === 0 ? (
            hasFilters ? (
              <EmptyState
                title="No matching anomalies"
                description="Try adjusting your filters to see more results."
              />
            ) : (
              <EmptyState
                title="No anomalies detected"
                description="Anomaly events will appear here when the detection engine identifies unusual pipeline behaviour."
              />
            )
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[30px]" />
                      <TableHead>Detected</TableHead>
                      <TableHead>Pipeline</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Deviation</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((anomaly) => {
                      const isExpanded = expandedId === anomaly.id;
                      return (
                        <Fragment key={anomaly.id}>
                          <TableRow
                            className="cursor-pointer"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : anomaly.id)
                            }
                          >
                            <TableCell className="w-[30px] px-2">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {formatTimestamp(anomaly.detectedAt)}
                            </TableCell>
                            <TableCell className="font-medium">
                              {anomaly.pipeline.name}
                            </TableCell>
                            <TableCell>
                              {ANOMALY_TYPE_LABELS[anomaly.anomalyType] ??
                                anomaly.anomalyType}
                            </TableCell>
                            <TableCell>
                              <SeverityBadge severity={anomaly.severity} />
                            </TableCell>
                            <TableCell className="font-mono tabular-nums">
                              {anomaly.deviationFactor.toFixed(2)}σ
                            </TableCell>
                            <TableCell>
                              <StatusBadge
                                variant={getStatusBadgeVariant(anomaly.status)}
                              >
                                {getStatusLabel(anomaly.status)}
                              </StatusBadge>
                            </TableCell>
                            <TableCell>
                              {(anomaly.status === "open" ||
                                anomaly.status === "acknowledged") && (
                                <div
                                  className="flex items-center gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {anomaly.status === "open" && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-6 gap-1 px-2 text-xs"
                                      disabled={isMutating}
                                      onClick={() =>
                                        handleAcknowledge(anomaly.id)
                                      }
                                    >
                                      <CheckCircle2 className="h-3 w-3" />
                                      Ack
                                    </Button>
                                  )}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-6 gap-1 px-2 text-xs"
                                    disabled={isMutating}
                                    onClick={() => handleDismiss(anomaly.id)}
                                  >
                                    <XCircle className="h-3 w-3" />
                                    Dismiss
                                  </Button>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>

                          {isExpanded && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={99} className="p-0">
                                <AnomalyDetailRow anomaly={anomaly} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {nextCursor && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="outline"
                    onClick={handleLoadMore}
                    disabled={isFetchingMore}
                  >
                    {isFetchingMore ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
