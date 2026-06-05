"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/loading-skeletons";
import { EmptyState } from "@/components/empty-state";
import { Activity } from "lucide-react";
import { formatLatency } from "@/lib/format";

/** Structurally a subset of the service `LakeTraceSpan`. */
export interface TraceSpanRow {
  spanId: string;
  parentSpanId: string;
  name: string;
  startTime: string;
  durationMs: number | null;
  severity: string;
  attrs: Record<string, string>;
}

interface OrderedSpan {
  span: TraceSpanRow;
  depth: number;
  /** Stable unique id for React keys + expansion state. Falls back to the
   *  source index when a span has no span id (log-like trace events share ""),
   *  so they don't collide. */
  key: string;
}

/**
 * Flatten spans into a parent→child pre-order with depth, so the list renders
 * indented like a tree. Spans whose parent is absent are roots; cycles/orphans
 * are appended defensively so nothing is dropped. Span ids may be empty (events
 * with a trace id but no span id) — visited tracking is by object identity and
 * each row gets a unique `key`, so empty ids never collapse rows together.
 */
function orderSpans(spans: TraceSpanRow[]): OrderedSpan[] {
  const indexOf = new Map<TraceSpanRow, number>();
  spans.forEach((s, i) => indexOf.set(s, i));
  const keyOf = (s: TraceSpanRow) => s.spanId || `__idx_${indexOf.get(s) ?? 0}`;

  // Real span ids → span, for parent resolution. Empty ids can't be a parent.
  const byId = new Map<string, TraceSpanRow>();
  for (const s of spans) if (s.spanId) byId.set(s.spanId, s);

  const children = new Map<string, TraceSpanRow[]>();
  const roots: TraceSpanRow[] = [];
  for (const s of spans) {
    if (s.parentSpanId && s.parentSpanId !== s.spanId && byId.has(s.parentSpanId)) {
      const list = children.get(s.parentSpanId) ?? [];
      list.push(s);
      children.set(s.parentSpanId, list);
    } else {
      roots.push(s);
    }
  }

  const out: OrderedSpan[] = [];
  const visited = new Set<TraceSpanRow>();
  function walk(span: TraceSpanRow, depth: number) {
    if (visited.has(span)) return;
    visited.add(span);
    out.push({ span, depth, key: keyOf(span) });
    if (span.spanId) {
      for (const child of children.get(span.spanId) ?? []) walk(child, depth + 1);
    }
  }
  for (const root of roots) walk(root, 0);
  for (const s of spans) if (!visited.has(s)) out.push({ span: s, depth: 0, key: keyOf(s) });
  return out;
}

export function TraceDetail({
  traceId,
  spans,
  isLoading,
  onBack,
}: {
  traceId: string;
  spans: TraceSpanRow[];
  isLoading: boolean;
  onBack: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const ordered = useMemo(() => orderSpans(spans), [spans]);
  const maxDuration = useMemo(
    () => Math.max(1, ...spans.map((s) => s.durationMs ?? 0)),
    [spans],
  );

  function toggle(spanId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(spanId)) next.delete(spanId);
      else next.add(spanId);
      return next;
    });
  }

  const header = (
    <div className="mb-3 flex items-center gap-2">
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        Traces
      </Button>
      <span className="truncate font-mono text-xs text-muted-foreground" title={traceId}>
        {traceId}
      </span>
    </div>
  );

  if (isLoading) {
    return (
      <div>
        {header}
        <TableSkeleton rows={6} />
      </div>
    );
  }
  if (ordered.length === 0) {
    return (
      <div>
        {header}
        <EmptyState icon={Activity} title="No spans" description="This trace has no spans." compact />
      </div>
    );
  }

  return (
    <div>
      {header}
      <ul className="space-y-0.5">
        {ordered.map(({ span, depth, key }) => {
          const isExpanded = expanded.has(key);
          const attrEntries = Object.entries(span.attrs ?? {}).sort(([a], [b]) =>
            a.localeCompare(b),
          );
          const widthPct =
            span.durationMs !== null ? Math.max(2, (span.durationMs / maxDuration) * 100) : 0;
          return (
            <li key={key}>
              <div
                className="flex items-center gap-2 rounded-[3px] py-1 hover:bg-bg-2"
                style={{ paddingLeft: depth * 16 }}
              >
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? "Collapse span" : "Expand span"}
                  className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
                <span className="w-[40%] min-w-0 truncate font-mono text-xs" title={span.name}>
                  {span.name}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-2">
                  <div
                    className={`h-full rounded-full ${
                      span.severity && /error/i.test(span.severity)
                        ? "bg-red-500/60"
                        : "bg-blue-500/50"
                    }`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                <span className="w-[80px] shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                  {span.durationMs !== null ? formatLatency(span.durationMs) : "—"}
                </span>
              </div>
              {isExpanded && (
                <div className="mb-1 ml-7 rounded-[3px] bg-bg-2/40 p-3" style={{ marginLeft: depth * 16 + 28 }}>
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
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
