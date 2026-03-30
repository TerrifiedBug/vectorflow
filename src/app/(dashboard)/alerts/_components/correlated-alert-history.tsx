// src/app/(dashboard)/alerts/_components/correlated-alert-history.tsx
"use client";

import { Fragment, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { Layers, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
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

import { CorrelationGroupRow } from "./correlation-group-row";
import { CorrelationGroupDetail } from "./correlation-group-detail";

import type { CorrelationGroupSummary } from "./correlation-group-row";

// ─── Component ───────────────────────────────────────────────────────────────

export function CorrelatedAlertHistory({
  environmentId,
}: {
  environmentId: string;
}) {
  const trpc = useTRPC();
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [allItems, setAllItems] = useState<CorrelationGroupSummary[]>([]);

  const groupsQuery = useQuery(
    trpc.alert.listCorrelationGroups.queryOptions(
      {
        environmentId,
        limit: 50,
        cursor,
        ...(statusFilter !== "all"
          ? {
              status: statusFilter as "firing" | "resolved" | "acknowledged",
            }
          : {}),
      },
      { enabled: !!environmentId },
    ),
  );

  const items = useMemo(
    () => (groupsQuery.data?.items ?? []) as CorrelationGroupSummary[],
    [groupsQuery.data?.items],
  );
  const nextCursor = groupsQuery.data?.nextCursor;
  const displayItems = cursor ? allItems : items;
  const isLoading = groupsQuery.isLoading;
  const isFetchingMore = groupsQuery.isFetching && !!cursor;

  const loadMore = useCallback(() => {
    if (nextCursor) {
      setAllItems((prev) => {
        const existing = new Set(prev.map((i) => i.id));
        const newItems = items.filter((i) => !existing.has(i.id));
        return [...prev, ...newItems];
      });
      setCursor(nextCursor);
    }
  }, [nextCursor, items]);

  const applyStatusFilter = useCallback((value: string) => {
    setStatusFilter(value);
    setCursor(undefined);
    setAllItems([]);
  }, []);

  const formatTimestamp = useCallback((date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleString();
  }, []);

  const firingCount = useMemo(
    () => displayItems.filter((g) => g.status === "firing").length,
    [displayItems],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Layers className="h-5 w-5 text-muted-foreground" />
        <h3 className="text-lg font-semibold">Correlated Alert Groups</h3>
        {firingCount > 0 && (
          <Badge variant="destructive" size="sm" className="tabular-nums">
            {firingCount} active
          </Badge>
        )}
      </div>

      {groupsQuery.isError ? (
        <QueryError
          message="Failed to load correlation groups"
          onRetry={() => groupsQuery.refetch()}
        />
      ) : isLoading && !cursor ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : displayItems.length === 0 ? (
        <EmptyState
          title="No correlated alert groups"
          description="When multiple related alerts fire together, they will be grouped here with root cause suggestions."
        />
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
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30px]" />
                  <TableHead>Opened</TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Node</TableHead>
                  <TableHead>Pipeline</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead colSpan={2}>Root Cause</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayItems.map((group) => {
                  const isExpanded = expandedGroupId === group.id;
                  return (
                    <Fragment key={group.id}>
                      <CorrelationGroupRow
                        group={group}
                        isExpanded={isExpanded}
                        onToggleExpand={setExpandedGroupId}
                        formatTimestamp={formatTimestamp}
                      />
                      {isExpanded && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={99} className="p-0">
                            <CorrelationGroupDetail
                              groupId={group.id}
                              environmentId={environmentId}
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
