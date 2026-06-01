"use client";

import { Fragment, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatTimeAxis, formatTimestamp } from "@/lib/format";
import { Inbox } from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/trpc/router";

type CpuHeatmapCell = inferRouterOutputs<AppRouter>["fleet"]["cpuHeatmap"][number];

interface FleetCpuHeatmapProps {
  data: CpuHeatmapCell[] | undefined;
  isLoading: boolean;
  range: string;
}

interface PivotRow {
  nodeId: string;
  nodeName: string;
}

interface Pivot {
  nodes: PivotRow[];
  /** distinct bucket ISO timestamps, ascending */
  buckets: string[];
  /** nodeId -> bucket ISO -> cpuLoad (1-min load average) */
  loads: Map<string, Map<string, number>>;
  maxLoad: number;
}

/** Pivot the flat cell list into node-rows x bucket-columns. */
function pivot(cells: CpuHeatmapCell[]): Pivot {
  const nodes: PivotRow[] = [];
  const seen = new Set<string>();
  const bucketSet = new Set<string>();
  const loads = new Map<string, Map<string, number>>();
  let maxLoad = 0;

  for (const c of cells) {
    if (!seen.has(c.nodeId)) {
      seen.add(c.nodeId);
      nodes.push({ nodeId: c.nodeId, nodeName: c.nodeName });
    }
    bucketSet.add(c.bucket);
    let row = loads.get(c.nodeId);
    if (!row) {
      row = new Map();
      loads.set(c.nodeId, row);
    }
    row.set(c.bucket, c.cpuLoad);
    if (c.cpuLoad > maxLoad) maxLoad = c.cpuLoad;
  }

  nodes.sort((a, b) => a.nodeName.localeCompare(b.nodeName));
  // ISO UTC strings sort lexicographically === chronologically.
  const buckets = [...bucketSet].sort();
  return { nodes, buckets, loads, maxLoad };
}

/** Escalating status tone (reused from the fleet hotness scale), keyed on
 *  intensity relative to the peak load in range. */
function cpuTone(ratio: number): string {
  if (ratio >= 0.85) return "var(--status-error)";
  if (ratio >= 0.5) return "var(--status-degraded)";
  return "var(--status-healthy)";
}

function HeatLegend({ maxLoad }: { maxLoad: number }) {
  const mid = (0.5 * maxLoad).toFixed(2);
  const hot = (0.85 * maxLoad).toFixed(2);
  const items = [
    { tone: "var(--status-healthy)", label: `≤ ${mid}` },
    { tone: "var(--status-degraded)", label: `${mid}–${hot}` },
    { tone: "var(--status-error)", label: `≥ ${hot}` },
  ];
  return (
    <div className="flex items-center gap-3 font-mono text-[10px] text-fg-3">
      <span className="uppercase tracking-[0.06em]">Load</span>
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1">
          <span
            className="h-2.5 w-2.5 rounded-[2px]"
            style={{ backgroundColor: it.tone }}
            aria-hidden
          />
          <span className="tabular-nums text-fg-2">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function HeatCell({
  nodeName,
  bucket,
  load,
  denom,
}: {
  nodeName: string;
  bucket: string;
  load: number | undefined;
  denom: number;
}) {
  const when = formatTimestamp(bucket);
  if (load === undefined) {
    const desc = `${nodeName}, ${when}: no data`;
    return (
      <div
        className="h-[18px] rounded-[2px] bg-bg-4/40"
        role="img"
        aria-label={desc}
        title={`${nodeName} · ${when} · no data`}
      />
    );
  }
  const ratio = load / denom;
  const pct = Math.round((0.2 + 0.8 * ratio) * 100);
  return (
    <div
      className="h-[18px] rounded-[2px]"
      style={{ backgroundColor: `color-mix(in oklab, ${cpuTone(ratio)} ${pct}%, transparent)` }}
      role="img"
      aria-label={`${nodeName}, ${when}: CPU load ${load.toFixed(2)}`}
      title={`${nodeName} · ${when} · load ${load.toFixed(2)}`}
    />
  );
}

export function FleetCpuHeatmap({ data, isLoading, range }: FleetCpuHeatmapProps) {
  const { nodes, buckets, loads, maxLoad } = useMemo(() => pivot(data ?? []), [data]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">CPU load heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[220px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (nodes.length === 0 || buckets.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">CPU load heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="flex flex-col items-center justify-center text-muted-foreground"
            style={{ height: 200 }}
          >
            <Inbox className="h-8 w-8 text-muted-foreground/50" />
            <p className="mt-2 text-sm">No CPU data for this range</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const denom = maxLoad > 0 ? maxLoad : 1;
  const first = buckets[0];
  const last = buckets[buckets.length - 1];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
        <CardTitle className="text-sm font-medium">
          CPU load heatmap
          <span className="ml-2 text-xs font-normal text-fg-3">
            peak {maxLoad.toFixed(2)} load avg
          </span>
        </CardTitle>
        <HeatLegend maxLoad={maxLoad} />
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <div
            className="grid items-center gap-[2px]"
            style={{ gridTemplateColumns: `150px repeat(${buckets.length}, minmax(14px, 1fr))` }}
          >
            <div />
            <div
              className="flex justify-between pb-1 font-mono text-[10px] text-fg-3"
              style={{ gridColumn: `span ${buckets.length}` }}
            >
              <span>{formatTimeAxis(new Date(first).getTime(), range)}</span>
              <span>{formatTimeAxis(new Date(last).getTime(), range)}</span>
            </div>

            {nodes.map((node) => {
              const row = loads.get(node.nodeId);
              return (
                <Fragment key={node.nodeId}>
                  <div
                    className="truncate pr-2 font-mono text-[11px] text-fg-2"
                    title={node.nodeName}
                  >
                    {node.nodeName}
                  </div>
                  {buckets.map((b) => (
                    <HeatCell
                      key={b}
                      nodeName={node.nodeName}
                      bucket={b}
                      load={row?.get(b)}
                      denom={denom}
                    />
                  ))}
                </Fragment>
              );
            })}
          </div>
        </div>
        <p className="mt-2 font-mono text-[10px] text-fg-3">
          Color intensity scaled to peak 1-min load average in the selected range.
        </p>
      </CardContent>
    </Card>
  );
}
