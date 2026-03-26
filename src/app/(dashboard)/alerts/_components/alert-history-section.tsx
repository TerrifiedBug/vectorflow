"use client";

import { Fragment, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  History,
} from "lucide-react";

import { DeliveryStatusPanel } from "./delivery-status-panel";
import { AlertTimeline } from "./alert-timeline";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { isFleetMetric } from "@/lib/alert-metrics";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Alert History Section ──────────────────────────────────────────────────────

export function AlertHistorySection({ environmentId }: { environmentId: string }) {
  const trpc = useTRPC();
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const queryClient = useQueryClient();
  const [allItems, setAllItems] = useState<
    Array<{
      id: string;
      status: string;
      value: number;
      message: string | null;
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
    }>
  >([]);

  const eventsQuery = useQuery(
    trpc.alert.listEvents.queryOptions(
      { environmentId, limit: 50, cursor },
      { enabled: !!environmentId },
    ),
  );

  const invalidateEvents = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: trpc.alert.listEvents.queryKey({ environmentId }),
    });
  }, [queryClient, trpc, environmentId]);

  const acknowledgeMutation = useMutation(
    trpc.alert.acknowledgeEvent.mutationOptions({
      onSuccess: () => {
        toast.success("Alert acknowledged");
        invalidateEvents();
      },
      onError: (error) => {
        toast.error(error.message || "Failed to acknowledge alert");
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Alert History</h3>
      </div>

      {eventsQuery.isError ? (
        <QueryError message="Failed to load alert events" onRetry={() => eventsQuery.refetch()} />
      ) : isLoading && !cursor ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : visibleItems.length === 0 && items.length === 0 ? (
        <EmptyState title="No alert events yet" description="Alert events will appear here when rules are triggered." />
      ) : (
        <Tabs defaultValue="table">
          <TabsList>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>

          {/* ── Table view ── */}
          <TabsContent value="table">
            <Table>
              <TableHeader>
                <TableRow>
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
                {visibleItems.map((event) => {
                  const isExpanded = expandedEventId === event.id;
                  return (
                    <Fragment key={event.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() =>
                          setExpandedEventId(isExpanded ? null : event.id)
                        }
                      >
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
                                    : "healthy"
                              }
                            >
                              {event.status === "firing"
                                ? "Firing"
                                : event.status === "acknowledged"
                                  ? "Acknowledged"
                                  : "Resolved"}
                            </StatusBadge>
                            {event.status === "firing" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 gap-1 px-2 text-xs"
                                disabled={acknowledgeMutation.isPending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  acknowledgeMutation.mutate({
                                    alertEventId: event.id,
                                  });
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

            {nextCursor && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  onClick={loadMore}
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
            <AlertTimeline events={visibleItems} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
