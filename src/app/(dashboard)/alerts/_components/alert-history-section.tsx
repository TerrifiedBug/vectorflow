"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import {
  Loader2,
  History,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
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

// ─── Alert History Section ──────────────────────────────────────────────────────

export function AlertHistorySection({ environmentId }: { environmentId: string }) {
  const trpc = useTRPC();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allItems, setAllItems] = useState<
    Array<{
      id: string;
      status: string;
      value: number;
      message: string | null;
      firedAt: Date;
      resolvedAt: Date | null;
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
      ) : displayItems.length === 0 && items.length === 0 ? (
        <EmptyState title="No alert events yet" description="Alert events will appear here when rules are triggered." />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
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
              {(cursor ? displayItems : items).map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {formatTimestamp(event.firedAt)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {event.alertRule.name}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.node?.host ?? "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.alertRule.pipeline?.name ?? "-"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      variant={
                        event.status === "firing" ? "error" : "healthy"
                      }
                    >
                      {event.status === "firing" ? "Firing" : "Resolved"}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className="font-mono">
                    {typeof event.value === "number"
                      ? event.value.toFixed(2)
                      : event.value}
                  </TableCell>
                  <TableCell className="max-w-[300px] truncate text-muted-foreground">
                    {event.message || "-"}
                  </TableCell>
                </TableRow>
              ))}
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
        </>
      )}
    </div>
  );
}
