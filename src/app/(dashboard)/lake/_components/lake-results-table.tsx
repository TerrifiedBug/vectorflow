"use client";

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
import { formatTimestamp } from "@/lib/format";
import { Search } from "lucide-react";

/** Minimal display shape — structurally a subset of the service `LakeEvent`. */
export interface LakeResultRow {
  timestamp: string;
  eventType: string;
  severity: string;
  host: string;
  source: string;
  message: string;
  traceId: string;
  attrs: Record<string, string>;
}

const EVENT_TYPE_TONE: Record<string, string> = {
  log: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  metric: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  trace: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

export function LakeResultsTable({
  rows,
  isLoading,
  isError,
  hasSearched,
  onRetry,
}: {
  rows: LakeResultRow[];
  isLoading: boolean;
  isError: boolean;
  hasSearched: boolean;
  onRetry: () => void;
}) {
  if (isError) {
    return <QueryError message="Search failed" onRetry={onRetry} />;
  }
  if (isLoading) {
    return <TableSkeleton rows={8} />;
  }
  if (!hasSearched) {
    return (
      <EmptyState
        icon={Search}
        title="Run a search"
        description="Pick a dataset and time range, then run a search to see events."
        compact
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No matching events"
        description="No events matched your filters in this time window."
        compact
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[180px]">Time</TableHead>
            <TableHead className="w-[80px]">Type</TableHead>
            <TableHead className="w-[100px]">Severity</TableHead>
            <TableHead className="w-[140px]">Host</TableHead>
            <TableHead>Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={`${row.timestamp}-${row.traceId}-${i}`}>
              <TableCell className="font-mono text-xs whitespace-nowrap">
                {formatTimestamp(row.timestamp)}
              </TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className={EVENT_TYPE_TONE[row.eventType] ?? ""}
                >
                  {row.eventType}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">{row.severity || "—"}</TableCell>
              <TableCell className="font-mono text-xs truncate" title={row.host}>
                {row.host || "—"}
              </TableCell>
              <TableCell className="max-w-0">
                <span className="block truncate font-mono text-xs" title={row.message}>
                  {row.message || "—"}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
