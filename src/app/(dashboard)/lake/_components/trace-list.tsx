"use client";

import { Activity } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { EmptyState } from "@/components/empty-state";
import { QueryError } from "@/components/query-error";
import { formatLatency, formatTimestamp } from "@/lib/format";

/** Structurally a subset of the service `LakeTraceSummary`. */
export interface TraceSummaryRow {
  traceId: string;
  spanCount: number;
  startTime: string;
  durationMs: number;
  status: string;
}

export function TraceList({
  traces,
  isLoading,
  isError,
  hasSearched,
  onSelect,
  onRetry,
}: {
  traces: TraceSummaryRow[];
  isLoading: boolean;
  isError: boolean;
  hasSearched: boolean;
  onSelect: (traceId: string) => void;
  onRetry: () => void;
}) {
  if (isError) {
    return <QueryError message="Trace search failed" onRetry={onRetry} />;
  }
  if (isLoading) {
    return <TableSkeleton rows={8} />;
  }
  if (!hasSearched) {
    return (
      <EmptyState
        icon={Activity}
        title="Find traces"
        description="Run a search to list traces grouped by trace id."
        compact
      />
    );
  }
  if (traces.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="No traces"
        description="No trace events matched your filters. Traces appear when the pipeline emits trace/span ids."
        compact
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Trace</TableHead>
            <TableHead className="w-[80px]">Spans</TableHead>
            <TableHead className="w-[110px]">Duration</TableHead>
            <TableHead className="w-[90px]">Status</TableHead>
            <TableHead className="w-[180px]">Started</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {traces.map((t) => (
            <TableRow key={t.traceId}>
              <TableCell className="max-w-0">
                <button
                  type="button"
                  onClick={() => onSelect(t.traceId)}
                  className="block w-full truncate text-left font-mono text-xs underline-offset-2 hover:underline"
                  title={t.traceId}
                >
                  {t.traceId}
                </button>
              </TableCell>
              <TableCell className="text-xs">{t.spanCount.toLocaleString()}</TableCell>
              <TableCell className="font-mono text-xs">{formatLatency(t.durationMs)}</TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className={
                    t.status === "error"
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {t.status}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-xs whitespace-nowrap">
                {formatTimestamp(t.startTime)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
