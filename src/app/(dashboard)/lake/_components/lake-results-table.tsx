"use client";

import { Fragment, useState } from "react";

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
import { ChevronDown, ChevronRight, Search } from "lucide-react";

/** Minimal display shape — structurally a subset of the service `LakeEvent`.
 *  `raw` + `attrs` arrive from `lake.search` and power the expandable detail. */
export interface LakeResultRow {
  timestamp: string;
  eventType: string;
  severity: string;
  host: string;
  source: string;
  message: string;
  traceId: string;
  raw: string;
  attrs: Record<string, string>;
}

const EVENT_TYPE_TONE: Record<string, string> = {
  log: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  metric: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  trace: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
};

/** Header columns + the leading expander column (drives the detail-row colSpan). */
const COLUMN_COUNT = 6;

/** Pretty-print a JSON payload for the detail view; fall back to the verbatim
 *  string when `raw` is not valid JSON (e.g. a plain syslog line). */
function prettyRaw(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function rowKey(row: LakeResultRow, index: number): string {
  return `${row.timestamp}-${row.traceId}-${index}`;
}

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
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

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
            <TableHead className="w-[32px]">
              <span className="sr-only">Toggle event details</span>
            </TableHead>
            <TableHead className="w-[180px]">Time</TableHead>
            <TableHead className="w-[80px]">Type</TableHead>
            <TableHead className="w-[100px]">Severity</TableHead>
            <TableHead className="w-[140px]">Host</TableHead>
            <TableHead>Message</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => {
            const key = rowKey(row, i);
            const isExpanded = expanded.has(key);
            const attrEntries = Object.entries(row.attrs ?? {}).sort(([a], [b]) =>
              a.localeCompare(b),
            );
            return (
              <Fragment key={key}>
                <TableRow>
                  <TableCell className="p-0 align-middle">
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      aria-expanded={isExpanded}
                      aria-label={
                        isExpanded ? "Collapse event details" : "Expand event details"
                      }
                      className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </TableCell>
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
                {isExpanded && (
                  <TableRow className="bg-bg-2/40 hover:bg-bg-2/40">
                    <TableCell colSpan={COLUMN_COUNT} className="p-4">
                      <div className="space-y-4">
                        <div>
                          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Attributes
                          </p>
                          {attrEntries.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No attributes.</p>
                          ) : (
                            <dl className="grid grid-cols-[minmax(120px,220px)_1fr] gap-x-4 gap-y-1">
                              {attrEntries.map(([k, v]) => (
                                <Fragment key={k}>
                                  <dt
                                    className="truncate font-mono text-[11px] text-muted-foreground"
                                    title={k}
                                  >
                                    {k}
                                  </dt>
                                  <dd className="break-all font-mono text-[11px]">{v}</dd>
                                </Fragment>
                              ))}
                            </dl>
                          )}
                        </div>
                        <div>
                          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            Raw
                          </p>
                          <pre className="max-h-80 overflow-auto rounded-[3px] bg-bg p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
                            {prettyRaw(row.raw)}
                          </pre>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
