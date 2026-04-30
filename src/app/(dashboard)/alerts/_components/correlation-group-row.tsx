// src/app/(dashboard)/alerts/_components/correlation-group-row.tsx
"use client";

import { Fragment } from "react";
import { ChevronDown, ChevronRight, Layers, Lightbulb } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CorrelationGroupEvent {
  id: string;
  status: string;
  value: number;
  message: string | null;
  firedAt: Date;
  alertRule: {
    id: string;
    name: string;
    metric: string;
    condition: string | null;
    threshold: number | null;
    pipeline: { id: string; name: string } | null;
  };
  node: { id: string; host: string } | null;
}

interface CorrelationGroupAnomalyEvent {
  id: string;
  status: string;
  anomalyType: string;
  severity: string;
  metricName: string;
  currentValue: number;
  message: string;
  detectedAt: Date;
  pipeline: { id: string; name: string };
}

type CorrelationGroupTimelineEvent =
  | (CorrelationGroupEvent & {
      kind: "alert";
      timestamp: Date;
    })
  | (CorrelationGroupAnomalyEvent & {
      kind: "anomaly";
      timestamp: Date;
    });

interface CorrelationGroupSummary {
  id: string;
  status: string;
  rootCauseSuggestion: string | null;
  eventCount: number;
  alertCount: number;
  anomalyCount: number;
  signalCount: number;
  openedAt: Date;
  closedAt: Date | null;
  events: CorrelationGroupEvent[];
  anomalyEvents: CorrelationGroupAnomalyEvent[];
  timeline: CorrelationGroupTimelineEvent[];
}

interface CorrelationGroupRowProps {
  group: CorrelationGroupSummary;
  isExpanded: boolean;
  onToggleExpand: (groupId: string | null) => void;
  formatTimestamp: (date: Date | string) => string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CorrelationGroupRow({
  group,
  isExpanded,
  onToggleExpand,
  formatTimestamp,
}: CorrelationGroupRowProps) {
  const firstSignal = group.timeline[0];
  const anomalyLabel = group.anomalyCount === 1 ? "anomaly" : "anomalies";
  const firingCount =
    group.events.filter((e) => e.status === "firing").length +
    group.anomalyEvents.filter((e) => e.status === "open").length;
  const groupName =
    firstSignal?.kind === "alert"
      ? firstSignal.alertRule.name
      : firstSignal
        ? formatAnomalyType(firstSignal.anomalyType)
        : "Correlated Signals";
  const nodeHost = firstSignal?.kind === "alert" ? firstSignal.node?.host : null;
  const pipelineName =
    firstSignal?.kind === "alert"
      ? firstSignal.alertRule.pipeline?.name
      : firstSignal?.pipeline.name;

  return (
    <Fragment>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => onToggleExpand(isExpanded ? null : group.id)}
      >
        <TableCell className="w-[30px] px-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="text-muted-foreground whitespace-nowrap">
          {formatTimestamp(group.openedAt)}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {groupName}
            </span>
            <Badge variant="secondary" size="sm" className="tabular-nums">
              {group.signalCount} signal{group.signalCount !== 1 ? "s" : ""}
            </Badge>
            {group.anomalyCount > 0 && (
              <Badge variant="outline" size="sm" className="tabular-nums">
                {group.alertCount} alert{group.alertCount !== 1 ? "s" : ""} / {group.anomalyCount} {anomalyLabel}
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {nodeHost ?? "-"}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {pipelineName ?? "-"}
        </TableCell>
        <TableCell>
          <StatusBadge
            variant={
              group.status === "firing"
                ? "error"
                : group.status === "acknowledged"
                  ? "degraded"
                  : "healthy"
            }
          >
            {group.status === "firing"
              ? `${firingCount} Firing`
              : group.status === "acknowledged"
                ? "Acknowledged"
                : "Resolved"}
          </StatusBadge>
        </TableCell>
        <TableCell colSpan={2}>
          {group.rootCauseSuggestion && (
            <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
              <Lightbulb className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-[400px]">
                {group.rootCauseSuggestion}
              </span>
            </div>
          )}
        </TableCell>
      </TableRow>
    </Fragment>
  );
}

function formatAnomalyType(type: string) {
  return type
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type {
  CorrelationGroupSummary,
  CorrelationGroupEvent,
  CorrelationGroupAnomalyEvent,
  CorrelationGroupTimelineEvent,
};
