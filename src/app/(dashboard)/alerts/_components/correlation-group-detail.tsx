// src/app/(dashboard)/alerts/_components/correlation-group-detail.tsx
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { toast } from "sonner";
import {
  CheckCircle2,
  Lightbulb,
  Loader2,
  AlertTriangle,
  Clock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CorrelationGroupDetailProps {
  groupId: string;
  environmentId: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CorrelationGroupDetail({
  groupId,
  environmentId,
}: CorrelationGroupDetailProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const groupQuery = useQuery(
    trpc.alert.getCorrelationGroup.queryOptions({ id: groupId }),
  );

  const acknowledgeMutation = useMutation(
    trpc.alert.acknowledgeGroup.mutationOptions({
      onSuccess: () => {
        toast.success("All alerts in group acknowledged");
        queryClient.invalidateQueries({
          queryKey: trpc.alert.getCorrelationGroup.queryKey({ id: groupId }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.alert.listCorrelationGroups.queryKey({
            environmentId,
          }),
        });
        queryClient.invalidateQueries({
          queryKey: trpc.dashboard.stats.queryKey({ environmentId }),
        });
      },
      onError: (error) => {
        toast.error(error.message || "Failed to acknowledge group", {
          duration: 6000,
        });
      },
    }),
  );

  const formatTimestamp = (date: Date | string) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return d.toLocaleString();
  };

  if (groupQuery.isLoading) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (groupQuery.isError || !groupQuery.data) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        Failed to load correlation group details.
      </div>
    );
  }

  const group = groupQuery.data;
  const hasFiringEvents = group.events.some((e) => e.status === "firing");

  return (
    <div className="space-y-4 p-4">
      {/* Root Cause Suggestion */}
      {group.rootCauseSuggestion && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Lightbulb className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              Suggested Root Cause
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {group.rootCauseSuggestion}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Group Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          <span>Opened: {formatTimestamp(group.openedAt)}</span>
          {group.closedAt && (
            <span className="ml-2">
              Closed: {formatTimestamp(group.closedAt)}
            </span>
          )}
        </div>
        {hasFiringEvents && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={acknowledgeMutation.isPending}
            onClick={() => acknowledgeMutation.mutate({ groupId })}
          >
            {acknowledgeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Acknowledge All ({group.events.filter((e) => e.status === "firing").length})
          </Button>
        )}
      </div>

      {/* Events Table */}
      <div className="overflow-x-auto">
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
            {group.events.map((event) => {
              const isRootCause = event.id === group.rootCauseEventId;
              return (
                <TableRow
                  key={event.id}
                  className={
                    isRootCause
                      ? "bg-amber-50/30 dark:bg-amber-950/10"
                      : undefined
                  }
                >
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {isRootCause && (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                      )}
                      {formatTimestamp(event.firedAt)}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    {event.alertRule.name}
                    {isRootCause && (
                      <span className="ml-1.5 text-[10px] font-normal text-amber-600 dark:text-amber-400 uppercase">
                        Root Cause
                      </span>
                    )}
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
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
