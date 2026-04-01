"use client";

import { Fragment, useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  History,
  XCircle,
} from "lucide-react";

import { DeliveryStatusPanel } from "./delivery-status-panel";
import { ErrorContextPanel } from "./error-context-panel";
import { AlertTimeline } from "./alert-timeline";
import { AnomalyHistorySection } from "./anomaly-history-section";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { isFleetMetric, getAlertCategory } from "@/lib/alert-metrics";
import type { Prisma } from "@/generated/prisma";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ───────────────────────────────────────────────────────────────────

type AlertEventItem = {
  id: string;
  status: string;
  value: number;
  message: string | null;
  errorContext: Prisma.JsonValue;
  firedAt: Date;
  resolvedAt: Date | null;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  node: { id: string; host: string } | null;
  alertRule: {
    id: string;
    name: string;
    metric: string;
    condition: string | null;
    threshold: number | null;
    pipeline: { id: string; name: string } | null;
  };
};

// ─── Internal AlertEventContent sub-component ────────────────────────────────

function AlertEventContent({
  items,
  nextCursor,
  isFetchingMore,
  onLoadMore,
  onAcknowledge,
  isPending,
  category,
  expandedEventId,
  onToggleExpand,
  formatTimestamp,
  hasFilters,
  selectedIds,
  onToggleSelection,
  onToggleSelectAll,
}: {
  items: AlertEventItem[];
  nextCursor: string | undefined;
  isFetchingMore: boolean;
  onLoadMore: () => void;
  onAcknowledge: (alertEventId: string) => void;
  isPending: boolean;
  category: "all" | "actionable" | "informational";
  expandedEventId: string | null;
  onToggleExpand: (id: string | null) => void;
  formatTimestamp: (date: Date | string) => string;
  hasFilters: boolean;
  selectedIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onToggleSelectAll: (items: AlertEventItem[]) => void;
}) {
  if (items.length === 0) {
    if (hasFilters) {
      return (
        <EmptyState
          title="No matching events"
          description="Try adjusting your filters or date range."
        />
      );
    }
    return (
      <EmptyState
        title={
          category === "actionable"
            ? "No actionable alerts"
            : category === "informational"
              ? "No informational events"
              : "No alert events yet"
        }
        description={
          category === "actionable"
            ? "Infrastructure and threshold alerts will appear here when rules fire."
            : category === "informational"
              ? "Deployment, node, and system events will appear here when triggered."
              : "Alert events will appear here when rules are triggered."
        }
      />
    );
  }

  return (
    <Tabs defaultValue="table">
      <TabsList>
        <TabsTrigger value="table">Table</TabsTrigger>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
      </TabsList>

      {/* ── Table view ── */}
      <TabsContent value="table">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30px] px-2">
                <Checkbox
                  checked={items.length > 0 && items.every((item) => selectedIds.has(item.id))}
                  onCheckedChange={() => onToggleSelectAll(items)}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead className="w-[30px]" />
              <TableHead>Timestamp</TableHead>
              <TableHead>Rule Name</TableHead>
              <TableHead>Node</TableHead>
              <TableHead>Pipeline</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Message</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((event) => {
              const isExpanded = expandedEventId === event.id;
              return (
                <Fragment key={event.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() =>
                      onToggleExpand(isExpanded ? null : event.id)
                    }
                  >
                    <TableCell className="w-[30px] px-2" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(event.id)}
                        onCheckedChange={() => onToggleSelection(event.id)}
                        aria-label={`Select alert ${event.alertRule.name}`}
                      />
                    </TableCell>
                    <TableCell className="w-[30px] px-2">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatTimestamp(event.firedAt)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {event.alertRule.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {event.node?.host ?? (isFleetMetric(event.alertRule.metric) ? "Fleet" : "-")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {event.alertRule.pipeline?.name ?? "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusBadge
                          variant={
                            event.status === "firing"
                              ? "error"
                              : event.status === "acknowledged"
                                ? "degraded"
                                : event.status === "dismissed"
                                  ? "neutral"
                                  : "healthy"
                          }
                        >
                          {event.status === "firing"
                            ? "Firing"
                            : event.status === "acknowledged"
                              ? "Acknowledged"
                              : event.status === "dismissed"
                                ? "Dismissed"
                                : "Resolved"}
                        </StatusBadge>
                        {event.status === "firing" && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-6 gap-1 px-2 text-xs"
                            disabled={isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              onAcknowledge(event.id);
                            }}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Ack
                          </Button>
                        )}
                      </div>
                      {event.status === "acknowledged" &&
                        event.acknowledgedAt && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {formatTimestamp(event.acknowledgedAt)}
                            {event.acknowledgedBy &&
                              ` by ${event.acknowledgedBy}`}
                          </p>
                        )}
                    </TableCell>
                    <TableCell className="font-mono tabular-nums">
                      {typeof event.value === "number"
                        ? event.value.toFixed(2)
                        : event.value}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate text-muted-foreground">
                      {event.message || "-"}
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={99} className="p-0">
                        {event.errorContext && (
                          <div className="px-4 pt-3">
                            <ErrorContextPanel
                              errorContext={event.errorContext as { lines: Array<{ timestamp: string; message: string }>; truncated: boolean }}
                              pipelineId={event.alertRule.pipeline?.id}
                            />
                          </div>
                        )}
                        <DeliveryStatusPanel
                          alertEventId={event.id}
                          isOpen={true}
                        />
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
              onClick={onLoadMore}
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
      </TabsContent>

      {/* ── Timeline view ── */}
      <TabsContent value="timeline">
        <AlertTimeline events={items} />
      </TabsContent>
    </Tabs>
  );
}

// ─── Alert History Section ──────────────────────────────────────────────────────

type AlertCategory = "all" | "actionable" | "informational" | "anomalies";

export function AlertHistorySection({
  environmentId,
  initialCategory,
}: {
  environmentId: string;
  initialCategory?: AlertCategory;
}) {
  const trpc = useTRPC();
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const [allItems, setAllItems] = useState<AlertEventItem[]>([]);
  const [category, setCategory] = useState<AlertCategory>(initialCategory ?? "actionable");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const applyStatusFilter = (value: string) => {
    setStatusFilter(value);
    setCursor(undefined);
    setAllItems([]);
    setSelectedIds(new Set());
  };

  const applyDateFrom = (value: string) => {
    setDateFrom(value);
    setCursor(undefined);
    setAllItems([]);
    setSelectedIds(new Set());
  };

  const applyDateTo = (value: string) => {
    setDateTo(value);
    setCursor(undefined);
    setAllItems([]);
    setSelectedIds(new Set());
  };

  const eventsQuery = useQuery(
    trpc.alert.listEvents.queryOptions(
      {
        environmentId,
        limit: 50,
        cursor,
        ...(statusFilter !== "all"
          ? { status: statusFilter as "firing" | "resolved" | "acknowledged" | "dismissed" }
          : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
      },
      { enabled: !!environmentId && category !== "anomalies" },
    ),
  );

  const invalidateEvents = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: trpc.alert.listEvents.queryKey({ environmentId }),
    });
    queryClient.invalidateQueries({
      queryKey: trpc.dashboard.stats.queryKey({ environmentId }),
    });
  }, [queryClient, trpc, environmentId]);

  const acknowledgeMutation = useMutation(
    trpc.alert.acknowledgeEvent.mutationOptions({
      onSuccess: () => {
        toast.success("Alert acknowledged");
        invalidateEvents();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to acknowledge alert", { duration: 6000 });
      },
    }),
  );

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(
    (items: AlertEventItem[]) => {
      setSelectedIds((prev) => {
        const allSelected = items.every((item) => prev.has(item.id));
        if (allSelected) {
          return new Set();
        }
        return new Set(items.map((item) => item.id));
      });
    },
    [],
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const bulkAcknowledgeMutation = useMutation(
    trpc.alert.bulkAcknowledge.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Acknowledged ${data.updated} alerts`);
        clearSelection();
        invalidateEvents();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to bulk acknowledge", { duration: 6000 });
      },
    }),
  );

  const bulkDismissMutation = useMutation(
    trpc.alert.bulkDismiss.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Dismissed ${data.updated} alerts`);
        clearSelection();
        invalidateEvents();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to bulk dismiss", { duration: 6000 });
      },
    }),
  );

  // Merge newly fetched items when data changes
  const items = eventsQuery.data?.items ?? [];
  const nextCursor = eventsQuery.data?.nextCursor;

  // Build display list: first page directly from query, subsequent pages accumulated
  const displayItems = cursor ? allItems : items;

  const loadMore = () => {
    if (nextCursor) {
      setAllItems((prev) => {
        // Combine previous items with current items, dedup by id
        const existing = new Set(prev.map((i) => i.id));
        const newItems = items.filter((i) => !existing.has(i.id));
        return [...prev, ...newItems];
      });
      setCursor(nextCursor);
    }
  };

  const formatTimestamp = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleString();
  };

  const isLoading = eventsQuery.isLoading;
  const isFetchingMore = eventsQuery.isFetching && !!cursor;

  // Merged list used by both views
  const visibleItems = cursor ? displayItems : items;

  // Client-side filtering by category (D-04)
  const filteredItems = useMemo(
    () =>
      category === "all"
        ? visibleItems
        : visibleItems.filter(
            (e) => getAlertCategory(e.alertRule.metric) === category,
          ),
    [visibleItems, category],
  );

  // Badge counts — computed from full visibleItems (not filteredItems) so counts stay stable across tab switches (D-08, D-09, D-10, D-11)
  const actionableCount = useMemo(
    () =>
      visibleItems.filter(
        (e) =>
          getAlertCategory(e.alertRule.metric) === "actionable" &&
          e.status === "firing",
      ).length,
    [visibleItems],
  );

  const informationalCount = useMemo(
    () =>
      visibleItems.filter(
        (e) =>
          getAlertCategory(e.alertRule.metric) === "informational" &&
          e.status === "firing",
      ).length,
    [visibleItems],
  );

  const anomalyCountQuery = useQuery(
    trpc.anomaly.countByPipeline.queryOptions(
      { environmentId },
      { enabled: !!environmentId },
    ),
  );

  const anomalyCount = useMemo(
    () => Object.values(anomalyCountQuery.data ?? {}).reduce((sum, count) => sum + count, 0),
    [anomalyCountQuery.data],
  );

  const hasFilters = statusFilter !== "all" || !!dateFrom || !!dateTo;

  const handleAcknowledge = useCallback(
    (alertEventId: string) => {
      acknowledgeMutation.mutate({ alertEventId });
    },
    [acknowledgeMutation],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Alert History</h3>
      </div>

      <Tabs
        value={category}
        onValueChange={(v) => setCategory(v as AlertCategory)}
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="actionable">
            Actionable
            {actionableCount > 0 && (
              <Badge variant="secondary" size="sm" className="ml-1.5 tabular-nums">
                {actionableCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="informational">
            Informational
            {informationalCount > 0 && (
              <Badge variant="secondary" size="sm" className="ml-1.5 tabular-nums">
                {informationalCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="anomalies">
            Anomalies
            {anomalyCount > 0 && (
              <Badge variant="secondary" size="sm" className="ml-1.5 tabular-nums">
                {anomalyCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {category === "anomalies" ? (
        <AnomalyHistorySection
          environmentId={environmentId}
          hideHeader
        />
      ) : eventsQuery.isError ? (
        <QueryError message="Failed to load alert events" onRetry={() => eventsQuery.refetch()} />
      ) : isLoading && !cursor ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={statusFilter} onValueChange={applyStatusFilter}>
                <SelectTrigger className="w-36 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="firing">Firing</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="acknowledged">Acknowledged</SelectItem>
                  <SelectItem value="dismissed">Dismissed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => applyDateFrom(e.target.value)}
                className="w-36 h-9"
                aria-label="From date"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => applyDateTo(e.target.value)}
                className="w-36 h-9"
                aria-label="To date"
              />
            </div>
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9"
                onClick={() => {
                  setStatusFilter("all");
                  setDateFrom("");
                  setDateTo("");
                  setCursor(undefined);
                  setAllItems([]);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2">
              <span className="text-sm font-medium">
                {selectedIds.size} selected
              </span>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={bulkAcknowledgeMutation.isPending}
                onClick={() =>
                  bulkAcknowledgeMutation.mutate({
                    alertEventIds: Array.from(selectedIds),
                  })
                }
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Acknowledge
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={bulkDismissMutation.isPending}
                onClick={() =>
                  bulkDismissMutation.mutate({
                    alertEventIds: Array.from(selectedIds),
                  })
                }
              >
                <XCircle className="h-3.5 w-3.5" />
                Dismiss
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={clearSelection}
              >
                Clear
              </Button>
            </div>
          )}

          <AlertEventContent
            items={filteredItems}
            nextCursor={nextCursor}
            isFetchingMore={isFetchingMore}
            onLoadMore={loadMore}
            onAcknowledge={handleAcknowledge}
            isPending={acknowledgeMutation.isPending}
            category={category}
            expandedEventId={expandedEventId}
            onToggleExpand={setExpandedEventId}
            formatTimestamp={formatTimestamp}
            hasFilters={hasFilters}
            selectedIds={selectedIds}
            onToggleSelection={toggleSelection}
            onToggleSelectAll={toggleSelectAll}
          />
        </>
      )}
    </div>
  );
}
