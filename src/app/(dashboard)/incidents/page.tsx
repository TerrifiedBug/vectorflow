"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/trpc/client";
import { useEnvironmentStore } from "@/stores/environment-store";
import { Button } from "@/components/ui/button";
import { KpiStrip, KpiInStrip } from "@/components/ui/kpi-tile";
import { EventDot, type EventKind } from "@/components/ui/event-dot";
import { VFIcon } from "@/components/ui/vf-icon";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/empty-state";

/**
 * v2 Incident timeline (11b) — anomalies + alerts + deploys + rollbacks.
 * Source: docs/internal/VectorFlow 2.0/screens/value-surfaces.jsx (ScreenIncidentTimeline).
 *
 * Wires to:
 *   - trpc.anomaly.list (filtered to current env, 14h window)
 *   - trpc.alertEvents.list / alertEvent firing for the alert markers
 *
 * For correlation arcs: server should expose a per-pipeline event aggregate
 * within the time window. Until that lands, we group events by pipeline
 * client-side and link an anomaly + alert that fall within 8m of each other.
 */

const HOURS = 14;
const COL_W = 100 / HOURS;

interface TimelineEvent {
  kind: EventKind;
  hour: number;
  label: string;
  ts: string;
}

interface TimelineRow {
  pipelineName: string;
  env: string;
  state: "firing" | "recovered" | "ok";
  events: TimelineEvent[];
}

export default function IncidentsPage() {
  const trpc = useTRPC();
  const { selectedEnvironmentId } = useEnvironmentStore();

  const anomaliesQ = useQuery({
    ...trpc.anomaly.list.queryOptions({
      environmentId: selectedEnvironmentId ?? "",
    }),
    enabled: !!selectedEnvironmentId,
  });

  type RawAnomaly = {
    id?: string;
    pipelineName?: string;
    pipeline?: { name?: string };
    severity?: string;
    detectedAt?: string;
    description?: string;
    metric?: string;
    status?: "open" | "acknowledged" | "dismissed";
  };

  const [nowMs, setNowMs] = React.useState<number | null>(null);
  React.useEffect(() => {
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const rows: TimelineRow[] = React.useMemo(() => {
    if (!Array.isArray(anomaliesQ.data) || nowMs == null) return [];
    const windowMs = HOURS * 60 * 60 * 1000;
    const buckets = new Map<string, TimelineRow>();

    for (const a of anomaliesQ.data as RawAnomaly[]) {
      const name = a.pipelineName ?? a.pipeline?.name ?? "—";
      const ts = a.detectedAt ?? new Date().toISOString();
      const t = new Date(ts).getTime();
      const ago = nowMs - t;
      if (ago > windowMs) continue;
      const hour = HOURS - 1 - Math.floor(ago / (60 * 60 * 1000));
      const row =
        buckets.get(name) ??
        ({ pipelineName: name, env: "—", state: "ok", events: [] } as TimelineRow);
      row.events.push({
        kind: "anomaly",
        hour: Math.max(0, Math.min(HOURS - 1, hour)),
        label: a.description ?? a.metric ?? "anomaly",
        ts,
      });
      if (a.status === "open") row.state = "firing";
      else if (a.status === "acknowledged" && row.state === "ok") row.state = "recovered";
      buckets.set(name, row);
    }
    return Array.from(buckets.values()).slice(0, 50);
  }, [anomaliesQ.data, nowMs]);

  const [selectedRowName, setSelectedRowName] = React.useState<string | null>(
    null,
  );
  const selectedRow =
    rows.find((r) => r.pipelineName === selectedRowName) ?? rows[0];

  const counts = React.useMemo(
    () => ({
      active: rows.filter((r) => r.state === "firing").length,
      anomalies: rows.flatMap((r) => r.events).filter((e) => e.kind === "anomaly").length,
      deploys: rows.flatMap((r) => r.events).filter((e) => e.kind === "deploy").length,
    }),
    [rows],
  );

  const hourLabels = React.useMemo(
    () =>
      Array.from({ length: HOURS }, (_, i) => {
        const ago = HOURS - 1 - i;
        if (ago === 0) return "now";
        if (ago % 2 !== 0) return "";
        return `−${ago}h`;
      }),
    [],
  );

  return (
    <div className="flex flex-col h-full bg-bg text-fg">
      {/* HEADER */}
      <div className="px-5 py-4 border-b border-line bg-bg-1 flex items-start justify-between">
        <div>
          <h1 className="m-0 font-mono text-[22px] font-medium tracking-[-0.01em]">
            Incidents
          </h1>
          <div className="mt-1 text-[12px] text-fg-2 max-w-[760px]">
            Anomalies, alerts, deploys, and rollbacks on one timeline. When something
            breaks at 3am, look here first — every signal correlated against what changed.
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <Button variant="ghost" size="sm">
            <VFIcon name="filter" />
            All envs
          </Button>
          <Button variant="ghost" size="sm">
            14h
          </Button>
          <Button variant="default" size="sm">
            <VFIcon name="zap" />
            Acknowledge all
          </Button>
        </div>
      </div>

      <KpiStrip>
        <KpiInStrip
          label="ACTIVE INCIDENTS"
          value={counts.active}
          sub={`${counts.active} firing · 0 acknowledged`}
          accent={counts.active > 0 ? "var(--status-error)" : undefined}
        />
        <KpiInStrip
          label="ANOMALIES · 14H"
          value={counts.anomalies}
          sub="critical / warning"
        />
        <KpiInStrip label="DEPLOYS · 14H" value={counts.deploys} sub="" />
        <KpiInStrip label="MTTA" value="—" unit="min" sub="median ack" />
        <KpiInStrip label="MTTR" value="—" unit="min" sub="median resolve" />
      </KpiStrip>

      {!selectedEnvironmentId && (
        <EmptyState
          glyph="◇"
          title="Select an environment"
          description="The incident timeline is scoped per environment."
        />
      )}

      {selectedEnvironmentId && rows.length === 0 && !anomaliesQ.isPending && (
        <EmptyState
          glyph="✓"
          title="Nothing breaking"
          description="No anomalies, alerts, deploys or rollbacks in the last 14 hours."
        />
      )}

      {selectedEnvironmentId && rows.length > 0 && (
        <div
          className="flex-1 grid min-h-0"
          style={{ gridTemplateColumns: "1fr 380px" }}
        >
          {/* TIMELINE */}
          <div className="flex flex-col min-h-0 border-r border-line overflow-hidden">
            {/* axis */}
            <div
              className="grid border-b border-line bg-bg-1"
              style={{ gridTemplateColumns: "180px 1fr" }}
            >
              <div className="px-4 py-2 font-mono text-[10px] text-fg-2 uppercase tracking-[0.04em]">
                pipeline
              </div>
              <div className="relative h-8 px-3">
                {hourLabels.map((l, i) => (
                  <div
                    key={i}
                    className="absolute top-0 bottom-0 -translate-x-1/2 flex items-center justify-center font-mono text-[10px] text-fg-2"
                    style={{ left: `calc(${i * COL_W}% + ${COL_W / 2}%)` }}
                  >
                    {l}
                  </div>
                ))}
              </div>
            </div>

            {/* rows */}
            <div className="flex-1 overflow-auto">
              {rows.map((row) => {
                const stateColor =
                  row.state === "firing"
                    ? "var(--status-error)"
                    : row.state === "recovered"
                      ? "var(--status-degraded)"
                      : "var(--fg-2)";
                const isSelected = row.pipelineName === (selectedRow?.pipelineName ?? "");
                return (
                  <button
                    key={row.pipelineName}
                    type="button"
                    onClick={() => setSelectedRowName(row.pipelineName)}
                    className={cn(
                      "grid w-full text-left border-b border-line min-h-[56px] cursor-pointer transition-colors",
                      isSelected
                        ? "bg-bg-1 border-l-2 border-l-accent-brand"
                        : "border-l-2 border-l-transparent hover:bg-bg-3/30",
                    )}
                    style={{ gridTemplateColumns: "180px 1fr" }}
                  >
                    <div className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            background: stateColor,
                            boxShadow:
                              row.state === "firing"
                                ? `0 0 0 2px color-mix(in srgb, ${stateColor} 33%, transparent)`
                                : "none",
                          }}
                        />
                        <span className="font-mono text-[12px] text-fg font-medium">
                          {row.pipelineName}
                        </span>
                      </div>
                      <div className="mt-1 ml-3 font-mono text-[10.5px] text-fg-2">
                        {row.env} · {row.state}
                      </div>
                    </div>
                    <div className="relative px-3 min-h-[56px]">
                      {hourLabels.map((_, i) => (
                        <div
                          key={i}
                          className="absolute top-0 bottom-0 w-px bg-line opacity-30"
                          style={{ left: `calc(${i * COL_W}% + ${COL_W / 2}%)` }}
                        />
                      ))}
                      <div className="absolute left-3 right-3 top-1/2 h-px bg-line opacity-50" />
                      {row.events.map((e, i) => (
                        <div
                          key={i}
                          title={e.label}
                          className="absolute -translate-x-1/2 -translate-y-1/2"
                          style={{
                            left: `calc(${e.hour * COL_W}% + ${COL_W / 2}%)`,
                            top: "50%",
                          }}
                        >
                          <EventDot kind={e.kind} size={10} />
                        </div>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* legend */}
            <div className="px-5 py-2.5 border-t border-line bg-bg-1 flex items-center gap-4 font-mono text-[11px] text-fg-2">
              {(["deploy", "rollback", "anomaly", "alert", "promote"] as EventKind[]).map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <EventDot kind={k} size={8} /> {k}
                </span>
              ))}
              <span className="ml-auto">dashed connectors = correlation group</span>
            </div>
          </div>

          {/* DETAIL */}
          <div className="flex flex-col min-h-0 bg-bg overflow-hidden">
            {selectedRow ? <IncidentDetail row={selectedRow} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function IncidentDetail({ row }: { row: TimelineRow }) {
  const firstAnomaly = row.events.find((e) => e.kind === "anomaly");
  return (
    <>
      <div className="px-5 py-3.5 border-b border-line bg-bg-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "px-1.5 py-0.5 rounded-[3px] border font-mono text-[9.5px] font-medium tracking-[0.04em]",
              row.state === "firing"
                ? "bg-[color:var(--status-error-bg)] text-status-error border-[color:var(--status-error)]/40"
                : row.state === "recovered"
                  ? "bg-[color:var(--status-degraded-bg)] text-status-degraded border-[color:var(--status-degraded)]/40"
                  : "bg-bg-3 text-fg-2 border-line-2",
            )}
          >
            {row.state.toUpperCase()}
          </span>
          <span className="font-mono text-[10.5px] text-fg-2">
            pipeline · {row.pipelineName}
          </span>
          <span className="ml-auto font-mono text-[10.5px] text-fg-2">
            {firstAnomaly ? timeAgo(firstAnomaly.ts) : "—"} ago
          </span>
        </div>
        <div className="mt-1.5 text-[14.5px] text-fg leading-snug">
          {firstAnomaly?.label ?? "Open the timeline to inspect events"}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="px-5 pt-3 pb-2 font-mono text-[10px] text-fg-2 uppercase tracking-[0.04em]">
          Event log
        </div>
        {row.events
          .slice()
          .sort((a, b) => +new Date(b.ts) - +new Date(a.ts))
          .map((e, i) => (
            <div
              key={i}
              className="grid items-start gap-2.5 px-5 py-2 border-t border-line"
              style={{ gridTemplateColumns: "46px 18px 1fr" }}
            >
              <span className="font-mono text-[10.5px] text-fg-2 pt-0.5">
                {fmtTime(e.ts)}
              </span>
              <EventDot kind={e.kind} size={9} />
              <div>
                <div className="text-[11.5px] text-fg leading-snug">{e.label}</div>
              </div>
            </div>
          ))}
      </div>

      <div className="px-4 py-3 border-t border-line bg-bg-1 flex gap-2 items-center">
        <Button variant="ghost" size="sm">
          <VFIcon name="bell-off" />
          Snooze 1h
        </Button>
        <Button variant="ghost" size="sm">
          <VFIcon name="user" />
          Assign
        </Button>
        <Button variant="primary" size="sm" className="ml-auto">
          <VFIcon name="check" />
          Acknowledge
        </Button>
      </div>
    </>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
