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

interface CorrelationGroupSummary {
  id: string;
  status: string;
  rootCauseSuggestion: string | null;
  eventCount: number;
  openedAt: Date;
  closedAt: Date | null;
  events: CorrelationGroupEvent[];
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
  const previewEvents = group.events;
  const firstEvent = previewEvents[0];
  const firingCount = previewEvents.filter((e) => e.status === "firing").length;

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
              {firstEvent?.alertRule.name ?? "Correlated Alerts"}
            </span>
            <Badge variant="secondary" size="sm" className="tabular-nums">
              {group.eventCount} alert{group.eventCount !== 1 ? "s" : ""}
            </Badge>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {firstEvent?.node?.host ?? "-"}
        </TableCell>
        <TableCell className="text-muted-foreground">
          {firstEvent?.alertRule.pipeline?.name ?? "-"}
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

export type { CorrelationGroupSummary, CorrelationGroupEvent };
